#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
sdk_dir="$project_dir/.tools/flutter"
if [ ! -e "$sdk_dir" ]; then
  mkdir -p "$project_dir/.tools"
  git clone --depth 1 --branch 3.47.6 https://github.com/flutter/flutter.git "$sdk_dir"
fi
cd "$project_dir"
"$sdk_dir/bin/flutter" --version
"$sdk_dir/bin/flutter" pub get
