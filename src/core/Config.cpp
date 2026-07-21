#include "core/Config.h"
#include <fstream>
#include <nlohmann/json.hpp>
#include <cstdio>

using json = nlohmann::json;

AppConfig loadConfig(const std::string& path) {
    AppConfig cfg;
    std::string p = path.empty() ? "hearme_config.json" : path;
    std::ifstream f(p);
    if (!f.is_open()) return cfg;
    try {
        json j = json::parse(f);
        if (j.contains("port"))             cfg.port = j["port"];
        if (j.contains("host"))             cfg.host = j["host"].get<std::string>();
        if (j.contains("bandsintown"))      cfg.bandsintownAppId = j["bandsintown"].get<std::string>();
        if (j.contains("songkick"))         cfg.songkickApiKey = j["songkick"].get<std::string>();
        if (j.contains("ticketmaster"))     cfg.ticketmasterKey = j["ticketmaster"].get<std::string>();
        if (j.contains("lastfm_api_key"))   cfg.lastfmApiKey = j["lastfm_api_key"].get<std::string>();
        if (j.contains("jellyfin_url"))     cfg.jellyfinUrl = j["jellyfin_url"].get<std::string>();
        if (j.contains("jellyfin_api_key")) cfg.jellyfinApiKey = j["jellyfin_api_key"].get<std::string>();
    } catch (...) {}
    return cfg;
}

void saveConfig(const AppConfig& cfg, const std::string& path) {
    std::string p = path.empty() ? "hearme_config.json" : path;
    json j;
    j["port"] = cfg.port;
    j["host"] = cfg.host;
    j["bandsintown"] = cfg.bandsintownAppId;
    j["songkick"] = cfg.songkickApiKey;
    j["ticketmaster"] = cfg.ticketmasterKey;
    j["lastfm_api_key"] = cfg.lastfmApiKey;
    j["jellyfin_url"] = cfg.jellyfinUrl;
    j["jellyfin_api_key"] = cfg.jellyfinApiKey;
    std::ofstream f(p);
    f << j.dump(4);
}
