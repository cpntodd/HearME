#include "network/LastfmClient.h"
#include "network/HttpClient.h"
#include <nlohmann/json.hpp>
#include <cstdio>

using json = nlohmann::json;

static std::string urlEncode(const std::string& s) {
    std::string out;
    for (char c : s) {
        if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') out += c;
        else { char buf[4]; snprintf(buf, 4, "%%%02X", (unsigned char)c); out += buf; }
    }
    return out;
}

void LastfmClient::fetchSimilar(const std::string& artistName,
    std::function<void(bool, std::vector<SimilarArtist>, std::string)> cb) {
    std::string url = "https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar"
                      "&artist=" + urlEncode(artistName) +
                      "&api_key=" + m_apiKey +
                      "&format=json&limit=15";

    m_http.fetch(url, {}, [cb = std::move(cb)](int status, const std::string& body) {
        if (status != 200 || body.empty()) { cb(false, {}, ""); return; }
        std::vector<SimilarArtist> similar;
        std::string bio;
        try {
            auto j = json::parse(body);
            if (j.contains("similarartists") && j["similarartists"].contains("artist")) {
                for (const auto& a : j["similarartists"]["artist"]) {
                    SimilarArtist sa;
                    sa.name = a.value("name", "");
                    sa.mbid = a.value("mbid", "");
                    sa.match = a.value("match", 0.0f);
                    similar.push_back(sa);
                }
            }
            // Bio is fetched separately — skip for now (adds a second API call)
        } catch (...) {}
        cb(!similar.empty(), similar, bio);
    });
}
