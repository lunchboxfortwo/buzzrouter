#!/usr/bin/env bash

set -euo pipefail

output_dir="${1:?usage: package-pages.sh OUTPUT_DIR}"

if [[ -e "$output_dir" ]]; then
  echo "Pages output directory already exists: $output_dir" >&2
  exit 1
fi

install -D -m 0644 public/prototype.html "$output_dir/index.html"
install -D -m 0644 public/prototype.css "$output_dir/prototype.css"
install -D -m 0644 public/prototype.js "$output_dir/prototype.js"
cp -R public/assets "$output_dir/assets"
cp -R public/fonts "$output_dir/fonts"

expected_files=(
  index.html
  prototype.css
  prototype.js
  assets/brand/buzzrouter-logo.png
  assets/communities/agent-commons.png
  assets/communities/growth-operators.png
  assets/communities/open-research.png
  assets/communities/prompt-forge.png
  assets/communities/story-lab.png
  assets/communities/vibe-coders-nyc.png
  fonts/instrument-sans-latin.woff2
)

for file in "${expected_files[@]}"; do
  test -s "$output_dir/$file"
done

test "$(find "$output_dir" -type f | wc -l)" -eq "${#expected_files[@]}"
