#include "network/HttpClient.h"
#include <cstdio>

HttpClient::HttpClient() {
    curl_global_init(CURL_GLOBAL_DEFAULT);
    m_worker = std::thread(&HttpClient::workerLoop, this);
}

HttpClient::~HttpClient() {
    m_running = false;
    if (m_worker.joinable()) m_worker.join();
    curl_global_cleanup();
}

void HttpClient::fetch(const std::string& url, const std::map<std::string, std::string>& headers, Callback cb) {
    Request req{url, "GET", "", headers, std::move(cb)};
    std::lock_guard<std::mutex> lock(m_mutex);
    m_queue.push(std::move(req));
}

void HttpClient::send(const std::string& url, const std::string& body,
                       const std::map<std::string, std::string>& headers, Callback cb) {
    Request req{url, "POST", body, headers, std::move(cb)};
    std::lock_guard<std::mutex> lock(m_mutex);
    m_queue.push(std::move(req));
}

size_t HttpClient::pending() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_queue.size();
}

void HttpClient::workerLoop() {
    while (m_running) {
        Request req;
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            if (m_queue.empty()) {
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
                continue;
            }
            req = std::move(m_queue.front());
            m_queue.pop();
        }

        CURL* curl = curl_easy_init();
        if (!curl) continue;

        std::string responseBody;
        curl_easy_setopt(curl, CURLOPT_URL, req.url.c_str());
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &responseBody);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);
        curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
        curl_easy_setopt(curl, CURLOPT_USERAGENT, "HearME/0.1.0 (music-discovery)");

        // Set custom headers
        struct curl_slist* headerList = nullptr;
        for (const auto& h : req.headers) {
            std::string hdr = h.first + ": " + h.second;
            headerList = curl_slist_append(headerList, hdr.c_str());
        }
        if (req.method == "POST") {
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, req.body.c_str());
            headerList = curl_slist_append(headerList, "Content-Type: application/json");
        }
        if (headerList) {
            curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headerList);
        }

        CURLcode res = curl_easy_perform(curl);
        long httpCode = 0;
        if (res == CURLE_OK) {
            curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);
        }

        if (req.callback) {
            req.callback(static_cast<int>(httpCode), responseBody);
        }

        curl_slist_free_all(headerList);
        curl_easy_cleanup(curl);
    }
}

size_t HttpClient::writeCallback(void* contents, size_t size, size_t nmemb, void* userp) {
    size_t totalSize = size * nmemb;
    auto* str = static_cast<std::string*>(userp);
    str->append(static_cast<char*>(contents), totalSize);
    return totalSize;
}
