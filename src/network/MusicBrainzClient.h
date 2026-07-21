#pragma once
#include <string>
#include <functional>
#include <vector>

struct ArtistInfo; // fwd from ecs/components.h

// MusicBrainz API client — artist search, relations, discography.
class MusicBrainzClient {
public:
    struct RelatedArtist {
        std::string id;
        std::string name;
        std::string type;     // "similar", "genre", "collaboration"
        float score = 0.0f;
        std::vector<std::string> genres;
    };

    using ArtistCallback = std::function<void(bool ok, std::vector<RelatedArtist> related)>;

    explicit MusicBrainzClient(class HttpClient& http) : m_http(http) {}

    // Fetch related artists for a given artist name.
    // Calls back with a list of RelatedArtist structs.
    void fetchRelated(const std::string& artistName, ArtistCallback cb);

    // Search for an artist by name. Returns MBID if found.
    void searchArtist(const std::string& name,
                      std::function<void(bool ok, std::string mbid, std::string displayName, std::vector<std::string> genres)> cb);

private:
    HttpClient& m_http;
};
