#!/bin/sh
set -e
API="${API_URL:-http://localhost:8080}"
printf 'window.__CONFIG__ = { API_URL: "%s" };\n' "$API" > /usr/share/nginx/html/config.js
echo "frontend configured with API_URL=$API"
