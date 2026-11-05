cmake_minimum_required(VERSION 3.20)
project(gf_engine CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(gf_engine STATIC src/Engine.cpp)
target_include_directories(gf_engine PUBLIC include)

# Host tests only when built on its own (the iOS/Android/WASM builds compile src/ directly).
if(PROJECT_IS_TOP_LEVEL)
  enable_testing()
  add_executable(engine_test test/engine_test.cpp)
  target_link_libraries(engine_test PRIVATE gf_engine)
  if(NOT MSVC)
    target_compile_options(gf_engine PRIVATE -Wall -Wextra -Werror)
    target_compile_options(engine_test PRIVATE -Wall -Wextra -Werror)
  endif()
  add_test(NAME engine_test COMMAND engine_test)
endif()
