import tempfile
import unicodedata
import unittest
from pathlib import Path

from tabs.meetings import vault_tree


class VaultTreeTest(unittest.TestCase):
    def setUp(self):
        self.base = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.vault = self.base / "vault"
        for folder in ("a", "B", ".hidden", "a/.git", "a/sub"):
            (self.vault / folder).mkdir(parents=True)
        for name in ("z.md", ".dot.md", "a/x.md", "a/.git/secret.md", ".hidden/h.md", "a/sub/깊은 파일.md"):
            (self.vault / name).write_text("x", encoding="utf-8")
        (self.base / "outside").mkdir()
        (self.base / "outside" / "o.md").write_text("x", encoding="utf-8")
        (self.vault / "out").symlink_to(self.base / "outside")

    def test_list_dir_one_level_dirs_first_hidden_and_escaping_links_excluded(self):
        self.assertEqual(vault_tree.list_dir(self.vault, ""), [
            {"name": "a", "path": "a", "dir": True},
            {"name": "B", "path": "B", "dir": True},
            {"name": "z.md", "path": "z.md", "dir": False},
        ])
        self.assertEqual(vault_tree.list_dir(self.vault, "a"), [
            {"name": "sub", "path": "a/sub", "dir": True},
            {"name": "x.md", "path": "a/x.md", "dir": False},
        ])

    def test_list_dir_rejects_files_escapes_and_hidden(self):
        for bad in ("..", "../outside", "/etc", "a/../..", "z.md", "a/.git", ".hidden", "없음", "out", "a//sub", "a\\sub"):
            with self.subTest(bad):
                self.assertIsNone(vault_tree.list_dir(self.vault, bad))

    def test_search_is_case_insensitive_and_skips_hidden(self):
        self.assertEqual(vault_tree.search(self.vault, "X.MD"), ([{"name": "x.md", "path": "a/x.md"}], False))
        self.assertEqual(vault_tree.search(self.vault, "secret"), ([], False))
        self.assertEqual(vault_tree.search(self.vault, "h.md"), ([], False))
        self.assertEqual(vault_tree.search(self.vault, "o.md"), ([], False))
        self.assertEqual(vault_tree.search(self.vault, "   "), ([], False))

    def test_search_limit_reports_truncation(self):
        many = self.vault / "many"
        many.mkdir()
        for i in range(60):
            (many / f"n{i:02}.txt").write_text("x", encoding="utf-8")
        results, truncated = vault_tree.search(self.vault, "many/n")
        self.assertEqual((len(results), truncated, results[0]["path"]), (50, True, "many/n00.txt"))

    def test_search_matches_nfd_names(self):
        nfd = unicodedata.normalize("NFD", "회의록.md")
        (self.vault / "a" / nfd).write_text("x", encoding="utf-8")
        results, _ = vault_tree.search(self.vault, "회의록")
        self.assertEqual(results, [{"name": "회의록.md", "path": "a/회의록.md"}])

    def test_search_results_in_path_order_across_depths(self):
        for name in ("Note.md", "z note.md", "a/note.md"):
            (self.vault / name).write_text("x", encoding="utf-8")
        results, truncated = vault_tree.search(self.vault, "note")
        self.assertEqual([r["path"] for r in results], ["a/note.md", "Note.md", "z note.md"])
        self.assertFalse(truncated)
        results, truncated = vault_tree.search(self.vault, "note", limit=2)
        self.assertEqual(([r["path"] for r in results], truncated), (["a/note.md", "Note.md"], True))


if __name__ == "__main__":
    unittest.main()
