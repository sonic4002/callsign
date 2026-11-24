#!/bin/sh
# Points the game's public name at this home's address with a plain (not proxied) DNS
# record, so that the Let's Encrypt certificate can be issued and served from this machine.
#
#   CALLSIGN_PUBLIC_URL   https://<name>, read from .env by the Makefile
#   CALLSIGN_CF_TOKEN     a Cloudflare API token that may edit DNS in that zone
#
# The address is asked from ifconfig.me. An existing record of that name is updated.
set -eu
: "${CALLSIGN_PUBLIC_URL:?set CALLSIGN_PUBLIC_URL=https://<name> in .env}"
: "${CALLSIGN_CF_TOKEN:?set CALLSIGN_CF_TOKEN to a Cloudflare token that may edit DNS}"
name=${CALLSIGN_PUBLIC_URL#https://}
name=${name%%/*}
api=https://api.cloudflare.com/client/v4
call() { curl -sS -H "Authorization: Bearer $CALLSIGN_CF_TOKEN" -H "Content-Type: application/json" "$@"; }
field() { python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('result'); r=r[0] if isinstance(r,list) and r else r; print((r or {}).get('$1','') if d.get('success') else '')"; }
why() { python3 -c "import sys,json; print('; '.join(e.get('message','') for e in json.load(sys.stdin).get('errors',[])) or 'no reason given')"; }

ip=$(curl -sS -4 --max-time 10 https://ifconfig.me)
[ -n "$ip" ] || { echo "could not learn this home's address from ifconfig.me" >&2; exit 1; }

# The zone is the longest suffix of the name that this token can see.
zone="" rest=$name
while [ -z "$zone" ] && [ "${rest#*.}" != "$rest" ]; do
  zone=$(call "$api/zones?name=$rest" | field id)
  [ -n "$zone" ] || rest=${rest#*.}
done
[ -n "$zone" ] || { echo "this token sees no zone for $name" >&2; exit 1; }

body="{\"type\":\"A\",\"name\":\"$name\",\"content\":\"$ip\",\"proxied\":false,\"ttl\":1,\"comment\":\"Callsign game\"}"
id=$(call "$api/zones/$zone/dns_records?type=A&name=$name" | field id)
if [ -n "$id" ]; then out=$(call -X PUT "$api/zones/$zone/dns_records/$id" --data "$body"); else out=$(call -X POST "$api/zones/$zone/dns_records" --data "$body"); fi
if [ -n "$(printf %s "$out" | field id)" ]; then
  echo "$name now points at this home."
else
  echo "Cloudflare refused: $(printf %s "$out" | why). The token needs Zone > DNS > Edit for $rest." >&2
  exit 1
fi
