#pragma once
#include <string>
#include <functional>
#include <map>
#include <curl/curl.h>
#include <thread>
#include <mutex>
#include <queue>

// Async HTTP client using libcurl. Requests are queued and processed
// on a background thread. Responses are delivered via callbacks.

class HttpClient {
public:
    using Callback = std::function<void(int status, const std::string& body)>;

    HttpClient();
    ~HttpClient();

    // Non-copyable
    HttpClient(const HttpClient&) = delete;
    HttpClient& operator=(const HttpClient&) = delete;

    // Queue a GET request. Callback fires on worker thread.
    void fetch(const std::string& url, const std::map<std::string, std::string>& headers, Callback cb);

    // Queue a POST request with JSON body.
    void send(const std::string& url, const std::string& body, const std::map<std::string, std::string>& headers, Callback cb);

    // Number of pending requests
    size_t pending() const;

private:
    void workerLoop();

    struct Request {
        std::string url;
        std::string method;
        std::string body;
        std::map<std::string, std::string> headers;
        Callback callback;
    };

    std::queue<Request> m_queue;
    mutable std::mutex m_mutex;
    std::thread m_worker;
    bool m_running = true;

    static size_t writeCallback(void* contents, size_t size, size_t nmemb, void* userp);
};
