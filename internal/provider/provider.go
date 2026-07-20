package provider

import (
	"context"

	"github.com/hearme/app/internal/models"
)

// ArtistProvider is implemented by each artist data source.
type ArtistProvider interface {
	Name() string
	Enabled() bool
	// Search finds artists matching a query. Returns candidates for disambiguation.
	Search(ctx context.Context, query string) ([]models.ArtistMatch, error)
	// GetRelated returns artists related to the given artist.
	GetRelated(ctx context.Context, artist models.Artist) ([]models.ArtistRelation, error)
	// GetMetadata enriches an artist with genres, image, popularity.
	GetMetadata(ctx context.Context, name string) (*models.Artist, error)
	// GetDiscography returns the artist's releases sorted by year descending.
	GetDiscography(ctx context.Context, artist models.Artist) ([]models.Release, error)
	// GetAlbumInfo returns full album details including tracklist.
	GetAlbumInfo(ctx context.Context, artistName, albumName string) (*models.AlbumDetail, error)
}

// TourProvider is implemented by each tour data source.
type TourProvider interface {
	Name() string
	Enabled() bool
	GetTours(ctx context.Context, artistNames []string) ([]models.Tour, error)
}
