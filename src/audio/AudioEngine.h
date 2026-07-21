#pragma once
// Audio engine stub — miniaudio integration placeholder.
// Phase 5 will implement: PCM streaming, 10-band EQ, FFT visualizers.

class AudioEngine {
public:
    AudioEngine() = default;
    ~AudioEngine() = default;

    bool init() { return true; }   // miniaudio init here
    void shutdown() {}              // miniaudio cleanup
    void play(const char* url) { (void)url; }
    void pause() {}
    void resume() {}
    void stop() {}
    void setVolume(float v) { (void)v; }
    float volume() const { return 0.8f; }
    bool isPlaying() const { return false; }

    // EQ / visualizer data — populated in Phase 5
    float eqBands[10] = {};
    float vuLeft = 0, vuRight = 0;
    float spectrumData[256] = {};
};
