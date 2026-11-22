/**
 * DISHA 8.2 — Enterprise IP & CIDR Utility Suite
 * Supports client IP extraction, IPv4/IPv6 validation, and bitwise CIDR subnet range checks.
 */

function cleanIP(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let ip = raw.trim();
  // Strip IPv4-mapped IPv6 prefix (e.g., ::ffff:192.168.1.1 -> 192.168.1.1)
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  // Normalize IPv6 loopback
  if (ip === '::1') {
    ip = '127.0.0.1';
  }
  return ip;
}

function getClientIP(req) {
  if (!req) return '127.0.0.1';

  // If Express trust proxy is active, prefer Express validated req.ip
  if (req.app && req.app.get && req.app.get('trust proxy') && req.ip) {
    return cleanIP(req.ip) || '127.0.0.1';
  }

  const isTrusted = req.app && req.app.get && req.app.get('trust proxy');

  // Trusted enterprise reverse proxy headers (e.g. Cloudflare) — only when trust proxy is enabled
  if (isTrusted && req.headers && req.headers['cf-connecting-ip']) {
    return cleanIP(req.headers['cf-connecting-ip']);
  }

  // Only check x-forwarded-for if trust proxy is explicitly enabled
  if (isTrusted && req.headers && req.headers['x-forwarded-for']) {
    const parts = String(req.headers['x-forwarded-for']).split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      return cleanIP(parts[0]);
    }
  }

  // Fallback to socket remoteAddress (cannot be spoofed via HTTP headers)
  const socketIP = (req.socket && req.socket.remoteAddress) ||
                   (req.connection && req.connection.remoteAddress) ||
                   req.ip;

  return cleanIP(socketIP) || '127.0.0.1';
}

function isValidIPv4(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return false;
    const n = parseInt(p, 10);
    if (n < 0 || n > 255 || (p.length > 1 && p.startsWith('0'))) return false;
  }
  return true;
}

function isValidIPv6(ip) {
  if (!ip || typeof ip !== 'string') return false;
  // Standard and shortened IPv6 format
  const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
  return ipv6Regex.test(ip) || ip === '::1';
}

function isValidIP(ip) {
  const cleaned = cleanIP(ip);
  return isValidIPv4(cleaned) || isValidIPv6(cleaned);
}

function isValidCIDR(cidr) {
  if (!cidr || typeof cidr !== 'string') return false;
  const parts = cidr.split('/');
  if (parts.length !== 2) return false;

  const [ip, prefixStr] = parts;
  if (!isValidIPv4(ip)) return false;
  if (!/^\d+$/.test(prefixStr)) return false;

  const prefix = parseInt(prefixStr, 10);
  return prefix >= 0 && prefix <= 32;
}

function ipv4ToLong(ip) {
  const parts = ip.split('.').map(p => parseInt(p, 10));
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Returns true if the IPv4 address is private or reserved (RFC 1918, loopback,
 * link-local, multicast, etc.). Used to reject spoofed X-Real-IP headers.
 */
function isPrivateOrReservedIP(ip) {
  if (!isValidIPv4(ip)) return false;
  const parts = ip.split('.').map(p => parseInt(p, 10));
  const [a, b] = parts;
  // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16,
  // 224.0.0.0/4 (multicast), 240.0.0.0/4 (reserved)
  return a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a === 127
    || (a === 169 && b === 254)
    || a >= 224;
}

/**
 * Bitwise subnet test: checks if an IPv4 address belongs to a CIDR range
 * Example: isIPInCIDR("52.84.123.45", "52.84.0.0/16") === true
 */
function isIPInCIDR(ip, cidr) {
  const cleanedIp = cleanIP(ip);
  if (!isValidIPv4(cleanedIp) || !isValidCIDR(cidr)) return false;

  const [rangeIp, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);

  if (prefix === 0) return true; // 0.0.0.0/0 covers entire IPv4 space

  const ipLong = ipv4ToLong(cleanedIp);
  const rangeLong = ipv4ToLong(rangeIp);

  // Compute 32-bit subnet mask
  const mask = (prefix === 32) ? 0xFFFFFFFF : ((0xFFFFFFFF << (32 - prefix)) >>> 0);

  return (ipLong & mask) === (rangeLong & mask);
}

module.exports = {
  cleanIP,
  getClientIP,
  isValidIP,
  isValidIPv4,
  isValidIPv6,
  isValidCIDR,
  ipv4ToLong,
  isIPInCIDR,
  isPrivateOrReservedIP
};
