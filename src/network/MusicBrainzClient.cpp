#include "network/MusicBrainzClient.h"
#include "network/HttpClient.h"
#include <nlohmann/json.hpp>
#include <cstdio>
#include <regex>

using json = nlohmann::json;

void MusicBrainzClient::fetchRelated(const std::string& artistName, ArtistCallback cb) {
    // Step 1: search for the artist MBID
    std::string encoded;
    for (char c : artistName) {
        if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') encoded += c;
        else { char buf[4]; snprintf(buf, 4, "%%%02X", (unsigned char)c); encoded += buf; }
    }
    std::string searchUrl = "https://musicbrainz.org/ws/2/artist/?query=artist:" + encoded + "&fmt=json&limit=5";

    m_http.fetch(searchUrl, {}, [this, artistName, cb = std::move(cb)](int status, const std::string& body) {
        if (status != 200 || body.empty()) {
            cb(false, {});
            return;
        }
        try {
            auto j = json::parse(body);
            std::string mbid;
            if (j.contains("artists") && !j["artists"].empty()) {
                // Use the first match with highest score
                for (const auto& a : j["artists"]) {
                    std::string name = a.value("name", "");
                    int score = a.value("score", 0);
                    // Normalize: strip parenthetical disambiguators for comparison
                    std::string cleanName = std::regex_replace(name, std::regex("\\([^)]*\\)"), "");
                    std::string cleanInput = std::regex_replace(artistName, std::regex("\\([^)]*\\)"), "");
                    // trim
                    cleanName.erase(0, cleanName.find_first_not_of(" \t"));
                    cleanName.erase(cleanName.find_last_not_of(" \t") + 1);
                    cleanInput.erase(0, cleanInput.find_first_not_of(" \t"));
                    cleanInput.erase(cleanInput.find_last_not_of(" \t") + 1);
                    if (score >= 80 || mbid.empty()) {
                        mbid = a.value("id", "");
                    }
                    (void)cleanName; (void)cleanInput;
                }
            }
            if (mbid.empty()) { cb(false, {}); return; }

            // Step 2: fetch related artists via the artist relations endpoint
            std::string relUrl = "https://musicbrainz.org/ws/2/artist/" + mbid + "?inc=url-rels+artist-rels&fmt=json";
            m_http.fetch(relUrl, {}, [cb = std::move(cb)](int s2, const std::string& b2) {
                if (s2 != 200 || b2.empty()) { cb(false, {}); return; }
                std::vector<RelatedArtist> results;
                try {
                    auto j2 = json::parse(b2);
                    if (j2.contains("relations")) {
                        for (const auto& rel : j2["relations"]) {
                            std::string type = rel.value("type", "");
                            if (type != "similar") continue;
                            if (rel.contains("artist")) {
                                RelatedArtist ra;
                                ra.id = rel["artist"].value("id", "");
                                ra.name = rel["artist"].value("name", "");
                                ra.type = "similar";
                                results.push_back(ra);
                            }
                        }
                    }
                    // Also check for tags/genres
                    if (j2.contains("tags")) {
                        for (const auto& tag : j2["tags"]) {
                            if (results.size() >= 20) break;
                            // Tags don't give us artist links, skip
                            (void)tag;
                        }
                    }
                } catch (...) {}
                cb(!results.empty(), results);
            });
        } catch (...) {
            cb(false, {});
        }
    });
}

void MusicBrainzClient::searchArtist(const std::string& name,
    std::function<void(bool, std::string, std::string, std::vector<std::string>)> cb) {
    std::string encoded;
    for (char c : name) {
        if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') encoded += c;
        else { char buf[4]; snprintf(buf, 4, "%%%02X", (unsigned char)c); encoded += buf; }
    }
    std::string url = "https://musicbrainz.org/ws/2/artist/?query=artist:" + encoded + "&fmt=json&limit=1";

    m_http.fetch(url, {}, [cb = std::move(cb), name](int status, const std::string& body) {
        if (status != 200 || body.empty()) { cb(false, "", "", {}); return; }
        try {
            auto j = json::parse(body);
            if (!j.contains("artists") || j["artists"].empty()) { cb(false, "", "", {}); return; }
            auto& a = j["artists"][0];
            std::string mbid = a.value("id", "");
            std::string dname = a.value("name", name);
            std::vector<std::string> genres;
            if (a.contains("tags")) {
                for (const auto& t : a["tags"]) {
                    genres.push_back(t.value("name", ""));
                }
            }
            cb(true, mbid, dname, genres);
        } catch (...) {
            cb(false, "", "", {});
        }
    });
}
