#!/bin/bash
cd "$(dirname "$0")"
export PORT=8082
export MONGO_URI="mongodb://127.0.0.1:27017,127.0.0.1:27018/incident_db?replicaSet=rs0"
node server.js
