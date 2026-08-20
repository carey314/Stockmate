#!/bin/bash
# APP 备案「特征信息」取值：从钥匙串里的苹果发布证书算出 公钥 + 签名值。
#
# 腾讯云备案表单三个字段的对应关系：
#   Bundle ID   → com.carey.stockmate（项目里写死的，见 ios/Runner.xcodeproj）
#   公钥        → 证书 RSA 公钥的 modulus（16进制，512 字符）
#   签名MD5值   → 名字骗人，实际要的是证书 SHA-1 指纹（16进制 40 位，去掉冒号）
#
# 证书一年一换，换完备案信息要同步更新，所以这脚本留着复用。
# 用法：bash scripts/beian-cert-info.sh
set -uo pipefail
TEAM="N4729NW9X3" # 智存的个人开发者团队（ios 工程 DEVELOPMENT_TEAM）
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "在钥匙串里找 $TEAM 的发布证书（Apple/iPhone Distribution）…"
echo

# 同名证书可能有多张（旧的没删），全列出来让用户自己认哪张有效
found=0
while IFS= read -r cn; do
  [ -z "$cn" ] && continue
  security find-certificate -c "$cn" -p > "$TMP/c.pem" 2>/dev/null || continue
  subject=$(openssl x509 -in "$TMP/c.pem" -noout -subject 2>/dev/null)
  echo "$subject" | grep -q "$TEAM" || continue
  found=$((found + 1))

  notafter=$(openssl x509 -in "$TMP/c.pem" -noout -enddate | sed 's/notAfter=//')
  if openssl x509 -in "$TMP/c.pem" -noout -checkend 0 >/dev/null 2>&1; then
    status="✅ 有效"
  else
    status="❌ 已过期，不能用于备案"
  fi

  echo "════════════════════════════════════════"
  echo "$subject"
  echo "有效期至：$notafter   $status"
  echo
  echo "【签名MD5值 栏】填这串（SHA-1，40位）："
  openssl x509 -in "$TMP/c.pem" -noout -fingerprint -sha1 | sed 's/.*=//' | tr -d ':'
  echo
  echo "【公钥 栏】填这串（modulus，512位）："
  openssl x509 -in "$TMP/c.pem" -noout -modulus | sed 's/Modulus=//'
  echo
done < <(security find-identity -v -p codesigning | grep -io '"[^"]*Distribution[^"]*"' | tr -d '"')

if [ "$found" -eq 0 ]; then
  echo "❌ 没找到 $TEAM 的发布证书。先创建："
  echo "   Xcode → Settings → Accounts → 选你的 Apple ID → 团队那行点 Manage Certificates"
  echo "   → 左下角 + → Apple Distribution → 创建完自动进钥匙串，再跑本脚本"
fi

echo "【Bundle ID 栏】com.carey.stockmate"
