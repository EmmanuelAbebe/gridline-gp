"""The https certificate (phones only give tilt data to https pages) and the pairing code in the QR link. Both are
kept in the data folder (paths.DATA) between runs."""
import datetime
import ipaddress
import secrets

from .paths import DATA


def ensure_cert(ip, folder=None):
    """Phones only give tilt sensor data to https pages, so we make a
    self-signed certificate for this PC's IP (regenerated if the IP changes)."""
    folder = folder or DATA
    cert_p, key_p, tag_p = folder / "cert.pem", folder / "key.pem", folder / ".cert_ip"
    # The certificate covers every address it was needed for (Wi-Fi and Bluetooth), so switching between them
    # doesn't make the phone accept a new one each time.
    known = []
    for k in (tag_p.read_text().split() if tag_p.exists() else []):
        try:
            known.append(str(ipaddress.ip_address(k)))
        except ValueError:
            pass
    if cert_p.exists() and key_p.exists() and ip in known:
        return cert_p, key_p
    ips = [ip] + [k for k in known if k != ip][:7]

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "phone-wheel")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=825))
        .add_extension(
            x509.SubjectAlternativeName(
                [x509.IPAddress(ipaddress.ip_address(a)) for a in ips] + [x509.DNSName("localhost")]
            ),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    key_p.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    cert_p.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    tag_p.write_text("\n".join(ips))
    return cert_p, key_p


def pairing_token(renew=False, folder=None):
    """Secret that goes into the QR link. Phones without it can't drive this PC, so other
    people on the same Wi-Fi can't take over. Kept between runs so a paired phone stays paired."""
    p = (folder or DATA) / "pairing_token"
    if not renew and p.exists():
        tok = p.read_text().strip()
        if len(tok) >= 16:
            return tok
    tok = secrets.token_urlsafe(16)
    p.write_text(tok)
    try:
        p.chmod(0o600)
    except OSError:
        pass
    return tok
