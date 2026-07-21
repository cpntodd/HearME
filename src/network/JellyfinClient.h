#pragma once
#include <string>
#include <vector>
#include <functional>
#include <entt/entt.hpp>

// Jellyfin API client — fetches library data and streams.
class JellyfinClient {
public:
    struct JellyfinArtist {
        std::string id;
        std::string name;
    };

    JellyfinClient(class HttpClient& http, const std::string& serverUrl, const std::string& apiKey);

    // Fetch all artists in the user's Jellyfin library
    void fetchArtists(std::function<void(bool ok, std::vector<JellyfinArtist> artists)> cb);

    // Fetch owned artist names (lighter call for cross-referencing)
    void fetchOwnedNames(std::function<void(bool ok, std::vector<std::string> names)> cb);

    bool enabled() const { return !m_serverUrl.empty() && !m_apiKey.empty(); }

private:
    HttpClient& m_http;
    std::string m_serverUrl;
    std::string m_apiKey;
    std::string m_token;
};
