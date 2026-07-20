package jellyfin

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client provides access to a Jellyfin server API.
type Client struct {
	baseURL string
	apiKey  string
	client  *http.Client
	token   string
	userID  string
}

// NewClient creates a new Jellyfin API client.
func NewClient(serverURL, apiKey string) *Client {
	return &Client{
		baseURL: strings.TrimRight(serverURL, "/"),
		apiKey:  apiKey,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

// Enabled returns true if the client is configured.
func (c *Client) Enabled() bool {
	return c.baseURL != "" && c.apiKey != ""
}

// authHeaderValue builds the X-Emby-Authorization header value.
func (c *Client) authHeaderValue() string {
	token := c.apiKey
	if c.token != "" {
		token = c.token
	}
	return fmt.Sprintf(
		`MediaBrowser Client="HearME", Device="PC", DeviceId="hearme-01", Version="0.1.0", Token="%s"`,
		token)
}

// do sends an authenticated GET request and unmarshals the JSON response.
func (c *Client) do(path string, result any) error {
	u := c.baseURL + path
	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Emby-Authorization", c.authHeaderValue())
	req.Header.Set("Accept", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("jellyfin request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("jellyfin %s: HTTP %d — %s", path, resp.StatusCode, string(body))
	}

	return json.NewDecoder(resp.Body).Decode(result)
}

// JFItem represents a Jellyfin library item (artist, album, or song).
type JFItem struct {
	ID             string            `json:"Id"`
	Name           string            `json:"Name"`
	Type           string            `json:"Type"`
	Album          string            `json:"Album"`
	AlbumArtist    string            `json:"AlbumArtist"`
	Artists        []string          `json:"Artists"`
	AlbumID        string            `json:"AlbumId"`
	IndexNumber    int               `json:"IndexNumber"`
	RunTimeTicks   int64             `json:"RunTimeTicks"`
	ProductionYear int               `json:"ProductionYear"`
	ImageTags      map[string]string `json:"ImageTags"`
	MediaSources   []JFMediaSource   `json:"MediaSources"`
}

// JFMediaSource holds stream info for an item.
type JFMediaSource struct {
	ID        string `json:"Id"`
	Path      string `json:"Path"`
	Container string `json:"Container"`
	Bitrate   int    `json:"Bitrate"`
	Size      int64  `json:"Size"`
}

// GetArtists returns all music artists.
func (c *Client) GetArtists() ([]JFItem, error) {
	var result struct {
		Items []JFItem `json:"Items"`
	}
	err := c.do("/Artists?Recursive=true&IncludeItemTypes=MusicArtist", &result)
	return result.Items, err
}

// GetAlbums returns all music albums, optionally filtered by artist.
func (c *Client) GetAlbums(artistID string) ([]JFItem, error) {
	path := "/Users/" + c.userID + "/Items?Recursive=true&IncludeItemTypes=MusicAlbum&SortBy=SortName"
	if artistID != "" {
		path += "&ArtistIds=" + artistID
	}
	var result struct {
		Items []JFItem `json:"Items"`
	}
	err := c.do(path, &result)
	return result.Items, err
}

// GetTracks returns tracks for a given album.
func (c *Client) GetTracks(albumID string) ([]JFItem, error) {
	path := "/Users/" + c.userID + "/Items?ParentId=" + albumID + "&IncludeItemTypes=Audio&SortBy=IndexNumber"
	var result struct {
		Items []JFItem `json:"Items"`
	}
	err := c.do(path, &result)
	return result.Items, err
}

// Search finds items matching a query.
func (c *Client) Search(query string) ([]JFItem, error) {
	path := fmt.Sprintf("/Users/%s/Items?SearchTerm=%s&Recursive=true&IncludeItemTypes=Audio&Limit=50",
		c.userID, url.QueryEscape(query))
	var result struct {
		Items []JFItem `json:"Items"`
	}
	err := c.do(path, &result)
	return result.Items, err
}

// StreamURL returns the direct streaming URL for a media item.
func (c *Client) StreamURL(itemID string) string {
	return fmt.Sprintf("%s/Audio/%s/stream.mp3?api_key=%s&Static=true",
		c.baseURL, itemID, c.apiKey)
}

// ImageURL returns the URL for an item's primary image.
func (c *Client) ImageURL(itemID string) string {
	return fmt.Sprintf("%s/Items/%s/Images/Primary?fillHeight=300&quality=90",
		c.baseURL, itemID)
}

// GetViewID finds the user's music library view ID.
func (c *Client) GetViewID() (string, error) {
	var result struct {
		Items []struct {
			ID             string `json:"Id"`
			CollectionType string `json:"CollectionType"`
		} `json:"Items"`
	}
	err := c.do("/Users/"+c.userID+"/Views", &result)
	if err != nil {
		return "", err
	}
	for _, v := range result.Items {
		if v.CollectionType == "music" {
			return v.ID, nil
		}
	}
	return "", fmt.Errorf("music library not found")
}

// GetUserID retrieves the user ID via API key auth.
func (c *Client) GetUserID() (string, error) {
	var result struct {
		ID   string `json:"Id"`
		Name string `json:"Name"`
	}
	err := c.do("/Users/Me", &result)
	if err != nil {
		return "", err
	}
	c.userID = result.ID
	return result.ID, nil
}

// Authenticate logs in and obtains a token (alternative to API key).
func (c *Client) Authenticate(username, password string) error {
	u := c.baseURL + "/Users/AuthenticateByName"
	body := fmt.Sprintf(`{"Username":%q,"Pw":%q}`, username, password)
	req, err := http.NewRequest("POST", u, strings.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Emby-Authorization",
		`MediaBrowser Client="HearME", Device="PC", DeviceId="hearme-01", Version="0.1.0"`)

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var result struct {
		AccessToken string `json:"AccessToken"`
		User        struct {
			ID   string `json:"Id"`
			Name string `json:"Name"`
		} `json:"User"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("auth failed: %w", err)
	}
	c.token = result.AccessToken
	c.userID = result.User.ID
	return nil
}
