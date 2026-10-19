"""The parts of Phone Wheel that need no phone, network tools or OS devices: message parsing, certificates and the
pairing code, Bluetooth output parsing, the keyboard pulses and the dry-run line.
Run from phone-wheel/: python -m unittest   (pytest works too)."""
import json
import tempfile
import unittest
from pathlib import Path

from phonewheel import certs, links, outputs, protocol


class Protocol(unittest.TestCase):
    def test_values_are_clamped_and_buttons_masked(self):
        d, v = protocol.parse_message(json.dumps({"s": -3, "g": 0.5, "b": 2, "k": 1 << 20 | 0b101, "p": 7}))
        self.assertEqual(v, (-1.0, 0.5, 1.0, 0b101))
        self.assertEqual(d["p"], 7)
        self.assertEqual(protocol.parse_message("{}")[1], (0.0, 0.0, 0.0, 0))

    def test_bad_messages_are_ignored(self):
        for bad in ("not json", '{"s": "left"}', '{"k": null}', "[1, 2]", "42"):
            self.assertIsNone(protocol.parse_message(bad), bad)

    def test_button_names(self):
        self.assertEqual(len(protocol.BUTTON_NAMES), 15)
        self.assertEqual(protocol.pressed(0b10000000011), ["A", "B", "RS"])
        self.assertEqual(protocol.squash("S l o w-Roads.io"), "slowroadsio")


class Certs(unittest.TestCase):
    def test_certificate_covers_every_address_it_was_made_for(self):
        from cryptography import x509
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            cert, _ = certs.ensure_cert("192.168.1.20", d)
            first = cert.read_bytes()
            certs.ensure_cert("192.168.1.20", d)
            self.assertEqual(cert.read_bytes(), first, "same address: kept")
            certs.ensure_cert("10.59.230.82", d)          # Bluetooth address: a new one with both
            san = x509.load_pem_x509_certificate(cert.read_bytes()).extensions.get_extension_for_class(x509.SubjectAlternativeName)
            ips = {str(a) for a in san.value.get_values_for_type(x509.IPAddress)}
            self.assertEqual(ips, {"192.168.1.20", "10.59.230.82"})
            second = cert.read_bytes()
            certs.ensure_cert("192.168.1.20", d)
            self.assertEqual(cert.read_bytes(), second, "switching back needs no new certificate")
            (d / ".cert_ip").write_text("garbage\n10.0.0.1")
            certs.ensure_cert("10.0.0.1", d)              # bad entries are dropped, not fatal

    def test_pairing_code_is_kept_until_renewed(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            a = certs.pairing_token(folder=d)
            self.assertGreaterEqual(len(a), 16)
            self.assertEqual(certs.pairing_token(folder=d), a)
            self.assertNotEqual(certs.pairing_token(renew=True, folder=d), a)
            (d / "pairing_token").write_text("short")
            self.assertNotEqual(certs.pairing_token(folder=d), "short", "too short: replaced")


class Bluetooth(unittest.TestCase):
    IP_JSON = json.dumps([
        {"ifname": "lo", "addr_info": [{"family": "inet", "local": "127.0.0.1"}]},
        {"ifname": "wlp3s0", "addr_info": [{"family": "inet", "local": "192.168.1.20"}]},
        {"ifname": "enx001a7dda7113", "addr_info": [{"family": "inet", "local": "10.59.230.82"}]},
    ])

    def test_link_address_from_ip_output(self):
        bt = lambda name: name.startswith("enx")       # what /sys/class/net/<if>/uevent says (udev-renamed bnep0)
        self.assertEqual(links.bt_addr_from_ip_json(self.IP_JSON, bt), ("enx001a7dda7113", "10.59.230.82"))
        self.assertIsNone(links.bt_addr_from_ip_json(self.IP_JSON, lambda n: False))
        self.assertIsNone(links.bt_addr_from_ip_json("", bt))
        self.assertIsNone(links.bt_addr_from_ip_json("{oops", bt))
        self.assertTrue(links.is_bt_iface("bnep0") and links.is_bt_iface("bt-pan"))

    def test_paired_devices(self):
        out = "Device 4C:2E:5E:11:22:33 Galaxy F23\nDevice AA:BB:CC:DD:EE:FF\nController 00:11:22:33:44:55 pc\n"
        self.assertEqual(links.parse_devices(out), [("4C:2E:5E:11:22:33", "Galaxy F23"), ("AA:BB:CC:DD:EE:FF", "AA:BB:CC:DD:EE:FF")])

    def test_picking_the_phone(self):
        phones = [("4C:2E:5E:11:22:33", "Galaxy F23", True), ("AA:BB:CC:DD:EE:FF", "Headphones", False)]
        self.assertEqual(links.match_phones(phones, "auto"), phones[:1])
        self.assertEqual(links.match_phones(phones, "galaxy"), phones[:1])
        self.assertEqual(links.match_phones(phones, "aa:bb:cc:dd:ee:ff"), phones[1:])
        self.assertEqual(links.pick_bt_phone("auto", phones), "4C:2E:5E:11:22:33")
        self.assertIsNone(links.pick_bt_phone("pixel", phones))
        self.assertIsNone(links.pick_bt_phone("auto", phones + [("11:22:33:44:55:66", "Tablet", True)]), "two can tether: ask")

    def test_nmcli_error_skips_the_hint(self):
        err = "Error: Connection activation failed: Carrier/link changed.\nHint: use 'journalctl -xe NM_CONNECTION=…' to get more details."
        self.assertEqual(links.nmcli_reason(err), "Error: Connection activation failed: Carrier/link changed.")
        self.assertEqual(links.nmcli_reason(""), "the phone didn't answer")


class Keyboard(unittest.TestCase):
    KEYS = list("1234567890-")

    def held(self, s, g, b, k, phase):
        return {key for key, on in outputs.pulse_keys(s, g, b, k, phase, 0.12, self.KEYS).items() if on}

    def test_partial_steering_pulses(self):
        self.assertEqual(self.held(0.05, 0, 0, 0, 0.0), set(), "inside the dead zone")
        half = 0.12 + 0.5 * 0.88                         # half way past the dead zone: held half of the cycle
        self.assertEqual(self.held(-half, 0, 0, 0, 0.49), {"left"})
        self.assertEqual(self.held(-half, 0, 0, 0, 0.51), set())
        self.assertEqual(self.held(1, 0, 0, 0, 0.99), {"right"})

    def test_pedals_and_buttons(self):
        self.assertEqual(self.held(0, 0.3, 0, 0, 0.2), {"up"})
        self.assertEqual(self.held(0, 0.3, 0, 0, 0.4), set())
        self.assertEqual(self.held(0, 0, 0.5, 0b11, 0.9), {"down", "1", "2"})
        self.assertEqual(self.held(0, 0, 0.01, 0, 0), set())

    def test_dry_run_line(self):
        line = outputs.dry_line(0.0, 1.0, 0.0, 0b100001)
        self.assertIn("[----------|---------]", line)
        self.assertIn("gas 1.00", line)
        self.assertIn("buttons RB A".replace("RB A", "A RB"), line)
        self.assertIn("[-------------------|]", outputs.dry_line(1.0, 0, 0, 0))


if __name__ == "__main__":
    unittest.main()
