#pragma once
#include <string>
#include <functional>
#include <vector>

// Last.fm API client — artist bios, similar artists, top tracks.
class LastfmClient {
public:
    struct SimilarArtist {
        std::string name;
        std::string mbid;
        float match = 0.0f;
    };

    explicit LastfmClient(class HttpClient& http, const std::string& apiKey)
        : m_http(http), m_apiKey(apiKey) {}

    // Fetch similar artists and bio for an artist name.
    void fetchSimilar(const std::string& artistName,
                      std::function<void(bool ok, std::vector<SimilarArtist> similar, std::string bio)> cb);

private:
    HttpClient& m_http;
    std::string m_apiKey;
};
