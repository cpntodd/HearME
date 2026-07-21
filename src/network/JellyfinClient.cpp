#include "network/JellyfinClient.h"
#include "network/HttpClient.h"
#include <nlohmann/json.hpp>
#include <cstdio>

using json = nlohmann::json;

JellyfinClient::JellyfinClient(HttpClient& http, const std::string& serverUrl, const std::string& apiKey)
    : m_http(http), m_serverUrl(serverUrl), m_apiKey(apiKey) {
    if (!serverUrl.empty()) {
        // Remove trailing slash
        if (m_serverUrl.back() == '/') m_serverUrl.pop_back();
    }
}

void JellyfinClient::fetchArtists(std::function<void(bool, std::vector<JellyfinArtist>)> cb) {
    if (!enabled()) { cb(false, {}); return; }
    std::string url = m_serverUrl + "/Artists?UserId=" + m_apiKey + "&Recursive=true";
    std::map<std::string, std::string> headers;
    headers["X-MediaBrowser-Token"] = m_apiKey;

    m_http.fetch(url, headers, [cb = std::move(cb)](int status, const std::string& body) {
        if (status != 200) { cb(false, {}); return; }
        std::vector<JellyfinArtist> artists;
        try {
            auto j = json::parse(body);
            if (j.contains("Items")) {
                for (const auto& item : j["Items"]) {
                    JellyfinArtist a;
                    a.id = item.value("Id", "");
                    a.name = item.value("Name", "");
                    artists.push_back(a);
                }
            }
        } catch (...) {}
        cb(!artists.empty(), artists);
    });
}

void JellyfinClient::fetchOwnedNames(std::function<void(bool, std::vector<std::string>)> cb) {
    fetchArtists([cb = std::move(cb)](bool ok, std::vector<JellyfinArtist> artists) {
        std::vector<std::string> names;
        for (auto& a : artists) names.push_back(a.name);
        cb(ok, names);
    });
}
