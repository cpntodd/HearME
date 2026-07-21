#pragma once
#include <string>

struct AppConfig {
    int  port = 8080;
    std::string host = "localhost";

    // Tour providers
    std::string bandsintownAppId;
    std::string songkickApiKey;
    std::string ticketmasterKey;

    // Artist providers
    std::string lastfmApiKey;

    // Jellyfin
    std::string jellyfinUrl;
    std::string jellyfinApiKey;
};

AppConfig loadConfig(const std::string& path = "");
void saveConfig(const AppConfig& cfg, const std::string& path = "");
