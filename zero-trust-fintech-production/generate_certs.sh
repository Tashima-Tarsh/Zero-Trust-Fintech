#!/usr/bin/env bash
mkdir -p certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/nginx.key -out certs/nginx.crt \
  -subj "/C=IN/ST=Karnataka/L=Bengaluru/O=ZeroTrustFintech/OU=Engineering/CN=localhost"
echo "✅ Self-signed SSL certificates generated in certs/"
