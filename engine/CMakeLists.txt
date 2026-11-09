cmake_minimum_required(VERSION 3.20)
project(gf_engine C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# vendored (engine/third_party/README.md); SYSTEM / -w so their warnings don't fail our -Werror
add_library(ebur128 STATIC third_party/libebur128/ebur128.c)
target_include_directories(ebur128 SYSTEM PUBLIC third_party/libebur128)
target_compile_options(ebur128 PRIVATE -w)
if(UNIX AND NOT APPLE)
  target_link_libraries(ebur128 PRIVATE m)
endif()

add_library(gf_engine STATIC src/Engine.cpp src/Mixer.cpp src/Loudness.cpp src/Analysis.cpp src/Pitch.cpp src/Beats.cpp)
target_include_directories(gf_engine PUBLIC include)
target_include_directories(gf_engine SYSTEM PRIVATE third_party third_party/signalsmith-basics/include)
target_link_libraries(gf_engine PRIVATE ebur128)

# Host tests only when built on its own (the iOS/Android/WASM builds compile src/ directly).
if(PROJECT_IS_TOP_LEVEL)
  enable_testing()
  foreach(t engine_test mix_test analysis_test beats_test)
    add_executable(${t} test/${t}.cpp)
    target_link_libraries(${t} PRIVATE gf_engine)
    if(NOT MSVC)
      target_compile_options(${t} PRIVATE -Wall -Wextra -Werror)
    endif()
    add_test(NAME ${t} COMMAND ${t})
  endforeach()
  if(NOT MSVC)
    target_compile_options(gf_engine PRIVATE -Wall -Wextra -Werror)
  endif()
endif()
