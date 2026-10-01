#!/bin/bash
cd "$(dirname "$0")"
export PORT=8083
echo "🤸 リハビリテーション指示システム (Port 8083) を起動します..."
node server.js
