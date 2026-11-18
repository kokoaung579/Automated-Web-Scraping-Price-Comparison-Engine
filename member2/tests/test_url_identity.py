import pytest

from member2.app.url_identity import canonicalize_url, generate_url_identity


def test_canonicalize_url_lowercases_scheme_and_hostname():
    assert (
        canonicalize_url("HTTPS://EXAMPLE.COM/Product")
        == "https://example.com/Product"
    )


def test_canonicalize_url_preserves_path_case():
    assert (
        canonicalize_url("https://example.com/Product")
        == "https://example.com/Product"
    )
    assert (
        canonicalize_url("https://example.com/product")
        == "https://example.com/product"
    )


def test_canonicalize_url_removes_fragment():
    assert (
        canonicalize_url("https://example.com/product#reviews")
        == "https://example.com/product"
    )


def test_canonicalize_url_preserves_root_path():
    assert canonicalize_url("https://example.com") == "https://example.com/"
    assert canonicalize_url("https://example.com/") == "https://example.com/"


def test_canonicalize_url_removes_non_root_trailing_slashes():
    assert (
        canonicalize_url("https://example.com/Product///")
        == "https://example.com/Product"
    )


def test_canonicalize_url_preserves_query_parameter_order():
    first = "https://example.com/products?a=1&b=2"
    second = "https://example.com/products?b=2&a=1"

    assert canonicalize_url(first) == first
    assert canonicalize_url(second) == second
    assert first != second


def test_different_sources_produce_different_identities():
    url = "https://example.com/product/1"

    assert generate_url_identity("DummyJSON", None, url) != generate_url_identity(
        "FakeStoreAPI", None, url
    )


def test_different_store_ids_produce_different_identities():
    url = "https://example.com/product/1"

    assert generate_url_identity("Example", "amazon", url) != generate_url_identity(
        "Example", "walmart", url
    )


def test_none_store_id_is_deterministic():
    url = "https://example.com/product/1"

    assert generate_url_identity("Example", None, url) == generate_url_identity(
        "Example", None, url
    )


def test_none_store_id_differs_from_real_store_id():
    url = "https://example.com/product/1"

    assert generate_url_identity("Example", None, url) != generate_url_identity(
        "Example", "amazon", url
    )


def test_none_store_id_differs_from_no_store_marker_string():
    url = "https://example.com/product/1"

    assert generate_url_identity("Example", None, url) != generate_url_identity(
        "Example", "<no-store>", url
    )


def test_similar_slug_shapes_produce_different_identities():
    assert generate_url_identity("Example", None, "https://example.com/A-B") != generate_url_identity(
        "Example", None, "https://example.com/A/B"
    )


def test_path_case_produces_different_identities():
    assert generate_url_identity("Example", None, "https://example.com/Product") != generate_url_identity(
        "Example", None, "https://example.com/product"
    )


@pytest.mark.parametrize(
    "url",
    ["", "not-a-url", "ftp://example.com/product", "https:///missing-host"],
)
def test_invalid_url_handling(url):
    with pytest.raises(ValueError, match="URL"):
        canonicalize_url(url)


def test_invalid_url_is_rejected_when_generating_identity():
    with pytest.raises(ValueError, match="URL"):
        generate_url_identity("Example", None, "not-a-url")


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com:bad/product",
        "https://example.com:65536/product",
        "https://example.com:99999/product",
    ],
)
def test_invalid_port_handling(url):
    with pytest.raises(ValueError, match="URL"):
        canonicalize_url(url)


@pytest.mark.parametrize("source_identity", ["", "   ", None])
def test_missing_source_identity_is_rejected(source_identity):
    with pytest.raises(ValueError, match="source_identity"):
        generate_url_identity(source_identity, None, "https://example.com/product")


def test_repeated_identical_inputs_produce_identical_sha256_identities():
    arguments = ("Example", "amazon", "https://example.com/Product/")

    first = generate_url_identity(*arguments)
    second = generate_url_identity(*arguments)

    assert first == second
    assert len(first) == 64
    assert all(character in "0123456789abcdef" for character in first)
