cmake_minimum_required(VERSION 3.20)
project(HearME VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# --- Dependencies ---
find_package(SDL2 REQUIRED)
find_package(OpenGL REQUIRED)
find_package(GLEW REQUIRED)
find_package(CURL REQUIRED)
find_package(Threads REQUIRED)
find_package(PkgConfig REQUIRED)

# Dear ImGui — header-only, we vendor it in third_party/
set(IMGUI_DIR ${CMAKE_SOURCE_DIR}/third_party/imgui)
add_library(imgui STATIC
    ${IMGUI_DIR}/imgui.cpp
    ${IMGUI_DIR}/imgui_draw.cpp
    ${IMGUI_DIR}/imgui_tables.cpp
    ${IMGUI_DIR}/imgui_widgets.cpp
    ${IMGUI_DIR}/backends/imgui_impl_sdl2.cpp
    ${IMGUI_DIR}/backends/imgui_impl_opengl3.cpp
)
target_include_directories(imgui PUBLIC ${IMGUI_DIR} ${IMGUI_DIR}/backends)
target_link_libraries(imgui PUBLIC SDL2::SDL2 OpenGL::GL GLEW::GLEW)

# EnTT — header-only
set(ENTT_DIR ${CMAKE_SOURCE_DIR}/third_party/entt/single_include)

# nlohmann/json — header-only
set(JSON_DIR ${CMAKE_SOURCE_DIR}/third_party/json/single_include)

# --- Source Files ---
file(GLOB_RECURSE HEARME_SOURCES
    src/*.cpp
    src/*.h
)

add_executable(hearme
    main.cpp
    ${HEARME_SOURCES}
)

target_include_directories(hearme PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${IMGUI_DIR}
    ${IMGUI_DIR}/backends
    ${ENTT_DIR}
    ${JSON_DIR}
)

target_link_libraries(hearme PRIVATE
    imgui
    SDL2::SDL2
    OpenGL::GL
    GLEW::GLEW
    CURL::libcurl
    Threads::Threads
    dl
)

# Release optimizations
if(CMAKE_BUILD_TYPE STREQUAL "Release")
    target_compile_options(hearme PRIVATE -O3 -march=native -flto)
    target_link_options(hearme PRIVATE -flto -s)
endif()
