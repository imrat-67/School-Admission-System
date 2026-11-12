#!/bin/sh
# Fires many applications at TWO backend processes (ports 8080 and 8081) that share one database,
# and checks that held + confirmed never goes above totalSeats.
# Needs only curl. Start both backends first:
#   docker compose -f docker-compose.yml -f docker-compose.two-backends.yml up --build -d
A="${API_A:-http://localhost:8080}"
B="${API_B:-http://localhost:8081}"
SEATS="${SEATS:-50}"
REQUESTS="${REQUESTS:-600}"

CID=$(curl -s -X POST "$A/classes" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Two-backend check $(date +%H:%M:%S)\",\"totalSeats\":$SEATS}" | sed 's/.*"id":"\([^"]*\)".*/\1/')
echo "class $CID with $SEATS seats, $REQUESTS parallel applications on $A and $B"

seq 1 "$REQUESTS" | xargs -P 80 -I{} sh -c '
  if [ $(( {} % 2 )) -eq 0 ]; then URL="'"$A"'"; else URL="'"$B"'"; fi
  ID=$(printf "2%016d" {})
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "$URL/classes/'"$CID"'/holds" -H "X-Student-Id: $ID"
' | sort | uniq -c

echo "--- class as seen by backend 1:"; curl -s "$A/classes/$CID"; echo
echo "--- class as seen by backend 2:"; curl -s "$B/classes/$CID"; echo
