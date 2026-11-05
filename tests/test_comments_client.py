import io
import unittest
import urllib.error

from tabs.comments.client import TromboneClient, TromboneError


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class ClientTest(unittest.TestCase):
    def test_non_json_body_is_trombone_error(self):
        client = TromboneClient("http://x", opener=lambda req, timeout: FakeResponse(b"<html>"))
        with self.assertRaises(TromboneError) as ctx:
            client.inbox()
        self.assertIn("VPN", str(ctx.exception))

    def test_http_401_keeps_status(self):
        def opener(req, timeout):
            raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, io.BytesIO(b'{"message":"bad"}'))

        with self.assertRaises(TromboneError) as ctx:
            TromboneClient("http://x", opener=opener).login("a", "b")
        self.assertEqual(ctx.exception.status, 401)
        self.assertIn("bad", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
