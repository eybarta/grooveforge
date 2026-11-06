cmake_minimum_required(VERSION 3.20)
project(gf_engine CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(gf_engine STATIC src/Engine.cpp src/Mixer.cpp)
target_include_directories(gf_engine PUBLIC include)
# vendored (engine/third_party/README.md); SYSTEM so their warnings don't fail our -Werror
target_include_directories(gf_engine SYSTEM PRIVATE third_party third_party/signalsmith-basics/include)

# Host tests only when built on its own (the iOS/Android/WASM builds compile src/ directly).
if(PROJECT_IS_TOP_LEVEL)
  enable_testing()
  foreach(t engine_test mix_test)
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
