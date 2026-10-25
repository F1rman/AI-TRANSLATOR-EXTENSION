"""Billable source words: UAX #29 segments containing a letter or number.

Punctuation, whitespace and emoji alone cost zero words. This is deterministic
Unicode segmentation, not language-specific dictionary tokenization: Han
characters are separate segments; Katakana and alphabetic runs can stay joined.
Count each submitted text segment separately so unrelated DOM nodes do not merge.
"""
from uniseg.wordbreak import words


def count_words(text: str) -> int:
    return sum(any(character.isalnum() for character in segment) for segment in words(text))
