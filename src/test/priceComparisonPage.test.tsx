import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PriceComparisonPage } from '../pages/PriceComparisonPage'
import type { AppOutletContext } from '../context/AppOutletContext'
import type {
  ComparisonResponse,
  ProductComparison,
  StoreOffer,
} from '../types/comparison'

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}

const stores = [
  {
    store_id: 'amazon',
    store_name: 'Amazon',
    website_url: 'https://www.amazon.com',
    logo_url: null,
    status: 'Active' as const,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
  {
    store_id: 'best-buy',
    store_name: 'Best Buy',
    website_url: 'https://www.bestbuy.com',
    logo_url: null,
    status: 'Active' as const,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
  {
    store_id: 'zone',
    store_name: 'Zone',
    website_url: 'https://zone.example',
    logo_url: null,
    status: 'Active' as const,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
  {
    store_id: 'inactive-store',
    store_name: 'Inactive Store',
    website_url: 'https://inactive.example',
    logo_url: null,
    status: 'Inactive' as const,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
]

function offer(overrides: Partial<StoreOffer> = {}): StoreOffer {
  return {
    store_id: 'amazon',
    store_name: 'Amazon',
    product_id: 'B0GHY4PR3N',
    offer_id: 'amazon-offer',
    price: { amount: 29.95, currency: 'USD' },
    availability: 'in_stock',
    source_type: 'scraped',
    verification_status: 'verified_scraped',
    eligibility: 'verified_comparison',
    verified: true,
    label: 'Verified scraped offer',
    last_updated: '2026-11-17T04:16:17.992Z',
    product_url: 'https://www.amazon.com/dp/B0GHY4PR3N',
    exclusion_reasons: [],
    ...overrides,
  }
}

function makeGroup(index = 0): ProductComparison {
  const canonicalKey = index === 0 ? 'asin:B0GHY4PR3N' : `product:manual-${index}`
  const name = index === 0 ? 'JBL Tune 530BT' : `Generic Product ${index}`
  return {
    identity: {
      canonical_key: canonicalKey,
      identity_type: index === 0 ? 'asin' : 'unmatched',
      identity_value: index === 0 ? 'B0GHY4PR3N' : `manual-${index}`,
      display_name: name,
      brand: index === 0 ? 'JBL' : 'Generic',
      model: index === 0 ? null : `M-${index}`,
      category: 'Audio',
      description:
        index === 0 ? 'Actual stored product description.' : 'Manual listing.',
      image_url: index === 0 ? 'https://images.example/jbl.jpg' : null,
      matched_product_ids: [index === 0 ? 'B0GHY4PR3N' : `listing-${index}`],
      evidence: [],
      needs_review: false,
      review_reason: null,
    },
    catalog_availability: 'in_stock',
    verified: {
      status: index === 0 ? 'verified_offers_available' : 'no_verified_offers',
      currency: index === 0 ? 'USD' : null,
      compared_offer_count: index === 0 ? 1 : 0,
      lowest:
        index === 0
          ? {
              store_id: 'amazon',
              store_name: 'Amazon',
              product_id: 'B0GHY4PR3N',
              offer_id: 'amazon-offer',
              amount: 29.95,
              currency: 'USD',
              last_updated: '2026-11-17T04:16:17.992Z',
            }
          : null,
      highest:
        index === 0
          ? {
              store_id: 'amazon',
              store_name: 'Amazon',
              product_id: 'B0GHY4PR3N',
              offer_id: 'amazon-offer',
              amount: 29.95,
              currency: 'USD',
              last_updated: '2026-11-17T04:16:17.992Z',
            }
          : null,
      price_difference: index === 0 ? { amount: 0, currency: 'USD' } : null,
      savings_percent_vs_highest: index === 0 ? 0 : null,
      message: index === 0 ? null : 'No verified In-Stock offers available',
    },
    illustrative: {
      offer_count: index === 0 ? 2 : 0,
      excluded_from_verified_pricing: true,
      lowest_display_only: null,
      highest_display_only: null,
      message: 'Manual illustrative prices are not verified live retailer prices.',
    },
    offers:
      index === 0
        ? [
            offer(),
            offer({
              store_id: 'best-buy',
              store_name: 'Best Buy',
              offer_id: 'bestbuy-offer',
              source_type: 'manual',
              verification_status: 'manual_illustrative',
              eligibility: 'display_only_illustrative',
              verified: false,
              label: 'Manual illustrative price — not verified live retailer data',
              price: { amount: 15.7, currency: 'USD' },
              product_id: 'B0GHY4PR3N-best-buy',
              product_url: 'https://www.amazon.com/dp/B0GHY4PR3N',
              exclusion_reasons: ['RETAILER_URL_MISSING'],
            }),
            offer({
              store_id: 'zone',
              store_name: 'Zone',
              offer_id: 'zone-offer',
              source_type: 'manual',
              verification_status: 'manual_illustrative',
              eligibility: 'display_only_illustrative',
              verified: false,
              label: 'Manual illustrative price — not verified live retailer data',
              price: { amount: 20, currency: 'USD' },
              product_id: 'B0GHY4PR3N-zone',
              product_url: 'https://www.amazon.com/dp/B0GHY4PR3N',
              exclusion_reasons: ['RETAILER_URL_MISSING'],
            }),
          ]
        : [],
    history: {
      available: index === 0,
      period: '30D',
      currency: 'USD',
      currency_source: 'verified_offer',
      series:
        index === 0
          ? [
              {
                store_id: 'amazon',
                store_name: 'Amazon',
                product_id: 'B0GHY4PR3N',
                verification_status: 'verified_scraped',
                points: [
                  { date: '2026-11-17', amount: 29.95 },
                  { date: '2026-11-18', amount: 28.95 },
                ],
              },
              {
                store_id: 'best-buy',
                store_name: 'Best Buy',
                product_id: 'B0GHY4PR3N-best-buy',
                verification_status: 'manual_illustrative',
                points: [{ date: '2026-11-18', amount: 15.7 }],
              },
            ]
          : [],
      message: index === 0 ? null : 'No stored history is available for this period.',
    },
    coverage: {
      active_stores_total: 3,
      stores_with_verified_offers: index === 0 ? 1 : 0,
      stores_with_illustrative_offers: index === 0 ? 2 : 0,
      stores_without_offers: index === 0 ? 0 : 3,
    },
    excluded_offers: [],
    latest_verified_update:
      index === 0 ? '2026-11-17T04:16:17.992Z' : null,
  }
}

function makeResponse(groupCount = 1, page = 1, pageSize = 15): ComparisonResponse {
  return {
    meta: {
      generated_at: '2026-11-20T10:30:00.000Z',
      source: 'mongodb',
      database: 'PriceComparison',
      query: {
        q: null,
        asin: null,
        brand: null,
        model: null,
        store_ids: [],
        availability: 'in_stock',
        period: '30D',
        include_illustrative: true,
        verified_only: false,
        include_history: true,
        max_offer_age_days: null,
        sort: 'verified_lowest',
        page,
        page_size: pageSize,
      },
      diagnostics: {
        active_store_ids: ['amazon', 'best-buy', 'zone'],
        excluded_offer_count: 1,
        excluded_product_count: 1,
        unmatched_product_count: 0,
        needs_review_group_count: 0,
        illustrative_offer_count: 2,
        excluded_orphan_offers: [],
      },
    },
    total_groups: groupCount,
    items: Array.from({ length: Math.min(pageSize, groupCount) }, (_, index) =>
      makeGroup(index),
    ),
  }
}

type HarnessOptions = {
  groupCount?: number
  context?: AppOutletContext | null
  error?: boolean
  comparisonHandler?: (url: URL) => unknown
}

function renderPage(options: HarnessOptions = {}) {
  const requests: URL[] = []
  const mutations: Array<{ path: string; body: unknown }> = []
  const groupCount = options.groupCount ?? 1
  const context = options.context

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      requests.push(url)
      const method = init?.method ?? 'GET'

      if (url.pathname === '/api/comparison/products') {
        if (options.error) return jsonResponse({ detail: 'Backend unavailable' }, 500)
        if (options.comparisonHandler) {
          const custom = options.comparisonHandler(url)
          if (custom) return jsonResponse(custom)
        }
        const search = url.searchParams.get('q')
        const page = Number(url.searchParams.get('page') ?? '1')
        const verifiedOnly = url.searchParams.get('verified_only') === 'true'
        const storeFilter = url.searchParams.getAll('store_id')
        let response = makeResponse(groupCount, page)
        if (search) {
          response = {
            ...response,
            total_groups: 1,
            items: [makeGroup(0)],
          }
        }
        if (verifiedOnly || storeFilter.length > 0) {
          response = {
            ...response,
            items: response.items.map((item) => ({
              ...item,
              offers: item.offers.filter(
                (entry) =>
                  entry.verification_status === 'verified_scraped' &&
                  (storeFilter.length === 0 ||
                    storeFilter.includes(entry.store_id)),
              ),
              illustrative: { ...item.illustrative, offer_count: 0 },
            })),
          }
        }
        return jsonResponse(response)
      }
      if (url.pathname === '/api/admin/stores') return jsonResponse(stores)
      if (url.pathname.startsWith('/api/watchlist/') && method === 'PUT') {
        mutations.push({ path: url.pathname, body: JSON.parse(String(init?.body)) })
        return jsonResponse({ productId: 'B0GHY4PR3N', addedAt: '2026-11-20T00:00:00Z' })
      }
      if (url.pathname === '/api/alerts' && method === 'POST') {
        mutations.push({ path: url.pathname, body: JSON.parse(String(init?.body)) })
        return jsonResponse({}, 201)
      }
      return jsonResponse({ detail: 'Not found' }, 404)
    }),
  )

  function ContextRoute() {
    return <Outlet context={context} />
  }

  render(
    <MemoryRouter initialEntries={['/comparison']}>
      <Routes>
        {context ? (
          <Route path="/comparison" element={<ContextRoute />}>
            <Route index element={<PriceComparisonPage />} />
          </Route>
        ) : (
          <Route path="/comparison" element={<PriceComparisonPage />} />
        )}
      </Routes>
    </MemoryRouter>,
  )

  return { requests, mutations }
}

const BREAKPOINT_PX = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const

function resolvesVisible(className: string, width: number) {
  let visible = !className.split(/\s+/).includes('hidden')
  for (const token of className.split(/\s+/)) {
    const match = /^(sm|md|lg|xl):(hidden|block|grid)$/.exec(token)
    if (match && width >= BREAKPOINT_PX[match[1] as keyof typeof BREAKPOINT_PX]) {
      visible = match[2] !== 'hidden'
    }
  }
  return visible
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.innerWidth = 1024
})

describe('Price Comparison page', () => {
  it('renders the header, search and verified vs illustrative offers', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Price Comparison' })).toBeDefined()
    expect(
      screen.getByText('Compare verified prices across registered stores.'),
    ).toBeDefined()
    expect(
      await screen.findByRole('button', { name: /JBL Tune 530BT/ }),
    ).toBeDefined()

    expect(screen.getAllByText('Catalog In Stock').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Verified · Scraped').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Illustrative · Manual').length).toBeGreaterThan(0)
    const summary = screen.getByLabelText('Verified price summary')
    expect(within(summary).getAllByText('$29.95').length).toBeGreaterThan(0)
    expect(within(summary).queryByText('$15.70')).toBeNull()
    expect(screen.getByText('Actual stored product description.')).toBeDefined()
  })

  it('includes a verified manual offer in verified pricing while keeping test-site data illustrative', async () => {
    renderPage({
      comparisonHandler: () => {
        const response = makeResponse(1)
        const group = response.items[0]
        const scraped = offer()
        const manualVerified = offer({
          store_id: 'zone',
          store_name: 'Zone',
          product_id: 'manual-product-1',
          offer_id: 'manual-offer-1',
          source_type: 'manual',
          verification_status: 'manually_verified',
          eligibility: 'verified_comparison',
          verified: true,
          label: 'Verified manual offer — admin checked the retailer',
          price: { amount: 39.99, currency: 'USD' },
          product_url: 'https://zone.example/manual-product-1',
          exclusion_reasons: [],
        })
        const testSite = offer({
          store_id: 'webscraper-io',
          store_name: 'WebScraper.io Test Site',
          product_id: 'webscraper-offer-1',
          offer_id: 'webscraper-offer-1',
          source_type: 'manual',
          verification_status: 'test_site_illustrative',
          eligibility: 'display_only_illustrative',
          is_test_site: true,
          verified: false,
          price: { amount: 1, currency: 'USD' },
          exclusion_reasons: [],
        })
        group.offers = [scraped, manualVerified, testSite]
        group.verified = {
          status: 'verified_offers_available',
          currency: 'USD',
          compared_offer_count: 2,
          lowest: {
            store_id: manualVerified.store_id,
            store_name: manualVerified.store_name,
            product_id: manualVerified.product_id,
            offer_id: manualVerified.offer_id,
            amount: manualVerified.price.amount,
            currency: manualVerified.price.currency,
            last_updated: manualVerified.last_updated,
          },
          highest: {
            store_id: scraped.store_id,
            store_name: scraped.store_name,
            product_id: scraped.product_id,
            offer_id: scraped.offer_id,
            amount: scraped.price.amount,
            currency: scraped.price.currency,
            last_updated: scraped.last_updated,
          },
          price_difference: { amount: 10.04, currency: 'USD' },
          savings_percent_vs_highest: 33.5,
          message: null,
        }
        group.illustrative = {
          offer_count: 1,
          excluded_from_verified_pricing: true,
          lowest_display_only: {
            store_id: testSite.store_id,
            store_name: testSite.store_name,
            product_id: testSite.product_id,
            offer_id: testSite.offer_id,
            amount: testSite.price.amount,
            currency: testSite.price.currency,
            last_updated: testSite.last_updated,
          },
          highest_display_only: {
            store_id: testSite.store_id,
            store_name: testSite.store_name,
            product_id: testSite.product_id,
            offer_id: testSite.offer_id,
            amount: testSite.price.amount,
            currency: testSite.price.currency,
            last_updated: testSite.last_updated,
          },
          message: 'Practice test-site prices are not real retailer offers.',
        }
        group.history.series = [
          {
            store_id: manualVerified.store_id,
            store_name: manualVerified.store_name,
            product_id: manualVerified.product_id,
            verification_status: 'manually_verified',
            points: [{ date: '2026-11-19', amount: 39.99 }],
          },
          {
            store_id: testSite.store_id,
            store_name: testSite.store_name,
            product_id: testSite.product_id,
            verification_status: 'test_site_illustrative',
            points: [{ date: '2026-11-19', amount: 1 }],
          },
        ]
        return response
      },
    })

    expect((await screen.findAllByText('Verified · Manual')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Verified · Scraped').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Test-site practice data').length).toBeGreaterThan(0)
    const summary = screen.getByLabelText('Verified price summary')
    expect(within(summary).getAllByText('$39.99').length).toBeGreaterThan(0)
    expect(within(summary).getAllByText('$29.95').length).toBeGreaterThan(0)
    expect(within(summary).queryByText('$1.00')).toBeNull()
  })

  it('labels test-site practice data and keeps it out of verified pricing', async () => {
    renderPage({
      comparisonHandler: () => {
        const response = makeResponse(1)
        const group = response.items[0]
        group.identity.is_test_site = true
        group.offers.push(offer({
          store_id: 'webscraper-io',
          store_name: 'WebScraper.io Test Site',
          product_id: 'webscraper-test-1',
          offer_id: 'webscraper-offer',
          price: { amount: 1, currency: 'USD' },
          source_type: 'scraped',
          verification_status: 'test_site_illustrative',
          eligibility: 'display_only_illustrative',
          verified: false,
          label: 'Practice test-site price — not a real retailer offer',
          product_url: 'https://webscraper.io/test-sites/e-commerce/allinone/product/1',
          is_test_site: true,
          exclusion_reasons: [],
        }))
        group.history.series.push({
          store_id: 'webscraper-io',
          store_name: 'WebScraper.io Test Site',
          product_id: 'webscraper-test-1',
          verification_status: 'test_site_illustrative',
          is_test_site: true,
          points: [{ date: '2026-11-18', amount: 1 }],
        })
        group.illustrative.offer_count = 3
        return response
      },
    })

    await screen.findByRole('button', { name: /JBL Tune 530BT/ })
    expect(screen.getAllByText('Test-site practice data').length).toBeGreaterThan(0)
    const summary = screen.getByLabelText('Verified price summary')
    expect(within(summary).queryByText('$1.00')).toBeNull()
  })

  it('uses the required history verification labels', async () => {
    renderPage({
      comparisonHandler: () => {
        const response = makeResponse(1)
        response.items[0].history.series = [
          {
            store_id: 'amazon',
            store_name: 'Amazon',
            product_id: 'B0GHY4PR3N',
            verification_status: 'verified_scraped',
            points: [{ date: '2026-11-17', amount: 29.95 }],
          },
          {
            store_id: 'best-buy',
            store_name: 'Best Buy',
            product_id: 'B0GHY4PR3N-best-buy',
            verification_status: 'manual_illustrative',
            points: [{ date: '2026-11-18', amount: 15.7 }],
          },
          {
            store_id: 'webscraper-io',
            store_name: 'WebScraper.io Test Site',
            product_id: 'webscraper-test-1',
            verification_status: 'test_site_illustrative',
            is_test_site: true,
            points: [{ date: '2026-11-18', amount: 1 }],
          },
          {
            store_id: 'zone',
            store_name: 'Zone',
            product_id: 'B0GHY4PR3N-zone',
            verification_status: 'unverified_excluded',
            points: [{ date: '2026-11-18', amount: 20 }],
          },
        ]
        return response
      },
    })

    await screen.findByRole('heading', { name: 'Price history' })
    expect(screen.getAllByText('Verified scraped').length).toBeGreaterThan(0)
    expect(screen.getByText('Manual illustrative')).toBeDefined()
    expect(screen.getAllByText('Test-site practice data').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Excluded / unavailable').length).toBeGreaterThan(0)
  })

  it.each([
    ['no_in_stock_offers', 'No In Stock offers match these filters'],
    ['catalog_in_stock_no_verified_offers', 'No verified In-Stock offers available'],
    ['only_illustrative_data', 'Only illustrative/test-site data is available'],
    ['no_offers', 'No offers found'],
  ] as const)(
    'shows the exact %s empty state',
    async (reason, message) => {
      renderPage({
        comparisonHandler: () => {
          const response = makeResponse(0)
          response.meta.diagnostics.empty_state_reason = reason
          return response
        },
      })
      expect(await screen.findByText(message)).toBeDefined()
    },
  )

  it('searches by ASIN, brand or model through the shared API client', async () => {
    const { requests } = renderPage()
    await screen.findByRole('button', { name: /JBL Tune 530BT/ })
    const search = screen.getByRole('searchbox', {
      name: /Search products by name, brand, model or ASIN/i,
    })
    await userEvent.type(search, 'B0GHY4PR3N')
    await waitFor(() => {
      expect(
        requests.some(
          (url) =>
            url.pathname === '/api/comparison/products' &&
            url.searchParams.get('q') === 'B0GHY4PR3N',
        ),
      ).toBe(true)
    })
    const clear = screen.getByRole('button', { name: 'Clear search' })
    await userEvent.click(clear)
    await waitFor(() => expect((search as HTMLInputElement).value).toBe(''))
  })

  it('applies store, availability and verified-only filters', async () => {
    const { requests } = renderPage()
    await screen.findByRole('button', { name: /JBL Tune 530BT/ })

    await userEvent.click(screen.getByRole('button', { name: 'Zone' }))
    await waitFor(() => {
      expect(
        requests.some(
          (url) => url.searchParams.getAll('store_id').join() === 'zone',
        ),
      ).toBe(true)
    })

    await userEvent.selectOptions(screen.getByRole('combobox'), 'all')
    await waitFor(() => {
      expect(
        requests.some((url) => url.searchParams.get('availability') === 'all'),
      ).toBe(true)
    })

    await userEvent.click(screen.getByRole('checkbox', { name: 'Verified only' }))
    await waitFor(() => {
      expect(
        requests.some((url) => url.searchParams.get('verified_only') === 'true'),
      ).toBe(true)
    })
    await waitFor(() => {
      expect(screen.queryByText('Illustrative · Manual')).toBeNull()
    })
  })

  it('shows an explicit no-verified-offers state for manual-only products', async () => {
    renderPage({ groupCount: 2 })
    await screen.findByRole('button', { name: /Generic Product 1/ })
    await userEvent.click(screen.getByRole('button', { name: /Generic Product 1/ }))
    expect(
      (await screen.findAllByText('No verified In-Stock offers available')).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText('$0.00')).toBeNull()
  })

  it('keeps a catalog In Stock product visible with no verified price', async () => {
    renderPage({
      comparisonHandler: () => {
        const response = makeResponse(1)
        const group = response.items[0]
        group.catalog_availability = 'in_stock'
        group.availability_state = 'catalog_in_stock_no_verified_offers'
        group.verified = {
          ...group.verified,
          status: 'no_verified_offers',
          currency: null,
          compared_offer_count: 0,
          lowest: null,
          highest: null,
          price_difference: null,
          savings_percent_vs_highest: null,
          message: 'No verified In-Stock offers available',
        }
        group.offers = []
        group.illustrative.offer_count = 0
        return response
      },
    })

    expect(
      await screen.findByRole('button', { name: /JBL Tune 530BT/ }),
    ).toBeDefined()
    expect(
      (await screen.findAllByText('No verified In-Stock offers available')).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Verified price summary')).toBeNull()
    expect(screen.getAllByText('Catalog In Stock').length).toBeGreaterThan(0)
  })

  it('switches history period and shows an empty state', async () => {
    const { requests } = renderPage({
      comparisonHandler: (url) => {
        if (url.searchParams.get('period') === '7D') {
          const response = makeResponse(1)
          response.items[0].history = {
            ...response.items[0].history,
            available: false,
            series: [],
            message: 'No stored history is available for this period.',
          }
          return response
        }
        return null
      },
    })
    await screen.findByRole('heading', { name: 'Price history' })
    expect(screen.getByText('Manual illustrative')).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: '7D' }))
    await waitFor(() => {
      expect(
        requests.some((url) => url.searchParams.get('period') === '7D'),
      ).toBe(true)
    })
    expect(
      await screen.findByText('No stored price history is available for this period.'),
    ).toBeDefined()
  })

  it('paginates search results', async () => {
    renderPage({ groupCount: 16 })
    expect(await screen.findByText(/Showing 1–15 of 16 results/)).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText(/Showing 16–16 of 16 results/)).toBeDefined()
  })

  it('renders loading and API error states', async () => {
    const { requests } = renderPage({ error: true })
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/Could not load comparisons/)).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: /Retry/ }))
    await waitFor(() => {
      expect(
        requests.filter(
          (url) => url.pathname === '/api/comparison/products',
        ).length,
      ).toBeGreaterThan(1)
    })
  })

  it('uses responsive table on desktop and cards on mobile', async () => {
    renderPage()
    await screen.findByRole('button', { name: /JBL Tune 530BT/ })
    const table = screen.getByRole('table')
    expect(table.closest('.md\\:block')).not.toBeNull()
    const cards = document.querySelector('.grid.gap-3.md\\:hidden')
    expect(cards).not.toBeNull()
  })

  it.each([320, 375, 430, 768, 820, 1024, 1280, 1440])(
    'uses a non-overflowing responsive layout at %ipx',
    async (width) => {
      window.innerWidth = width
      window.dispatchEvent(new Event('resize'))
      renderPage()
      await screen.findByRole('button', { name: /JBL Tune 530BT/ })

      const tableShell = document.querySelector('.hidden.md\\:block') as HTMLElement | null
      const mobileCards = document.querySelector('.grid.gap-3.md\\:hidden') as HTMLElement | null
      expect(tableShell).not.toBeNull()
      expect(mobileCards).not.toBeNull()
      expect(resolvesVisible(tableShell!.className, width)).toBe(width >= 768)
      expect(resolvesVisible(mobileCards!.className, width)).toBe(width < 768)

      expect(tableShell!.querySelector('.overflow-x-auto')).not.toBeNull()
      expect(tableShell!.querySelector('.min-w-\\[820px\\]')).not.toBeNull()

      const search = screen.getByRole('searchbox', {
        name: /Search products by name, brand, model or ASIN/i,
      })
      expect(search.className).toContain('w-full')
      expect(search.className).toContain('pl-9')

      const pagination = screen.getByRole('group', {
        name: 'Search result pages',
      })
      expect(pagination.className).toContain('flex-wrap')
      expect(
        within(pagination).getByRole('button', { name: 'Previous page' }).className,
      ).toContain('min-h-10')

      const summary = screen.getByLabelText('Verified price summary')
      expect(summary.className).toContain('grid-cols-2')
      if (width >= 1024) {
        expect(summary.className).toContain('lg:grid-cols-4')
      }

      const selectorGrid = screen
        .getByLabelText('Search products to compare')
        .querySelector('.grid.gap-2.sm\\:grid-cols-2.xl\\:grid-cols-3')
      expect(selectorGrid).not.toBeNull()
      if (width >= 640) {
        expect(selectorGrid!.className).toContain('sm:grid-cols-2')
      }
      if (width >= 1280) {
        expect(selectorGrid!.className).toContain('xl:grid-cols-3')
      }
    },
  )

  it('limits the page strip for large result sets', async () => {
    renderPage({ groupCount: 200 })
    await screen.findByRole('button', { name: /JBL Tune 530BT/ })

    const pagination = screen.getByRole('group', {
      name: 'Search result pages',
    })
    expect(within(pagination).getByRole('button', { name: 'Page 1' })).toBeDefined()
    expect(within(pagination).getByRole('button', { name: 'Page 2' })).toBeDefined()
    expect(within(pagination).getByRole('button', { name: 'Page 14' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Page 3' })).toBeNull()
    expect(pagination.textContent).toContain('…')
  })

  it('integrates user-specific watchlist and alerts when supported', async () => {
    const context = {
      products: [
        {
          id: 'B0GHY4PR3N',
          name: 'JBL Tune 530BT',
          brand: 'JBL',
          category: 'Audio',
          store: 'Amazon',
          price: 29.95,
          previousPrice: 29.95,
          updated: 'Now',
          updatedAt: '2026-11-17T04:16:17.992Z',
          specifications: [],
          tone: 'text-blue-200',
          icon: () => null,
          imageUrl: null,
        },
      ],
      watchlistIds: [],
      saveAlert: vi.fn(async () => true),
      toggleWatchlist: vi.fn(),
    } as unknown as AppOutletContext

    const { mutations } = renderPage({ context })
    await screen.findByRole('button', { name: 'Add to watchlist' })
    await userEvent.click(screen.getByRole('button', { name: 'Add to watchlist' }))
    expect(context.toggleWatchlist).toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Create price alert' }))
    const target = screen.getByRole('spinbutton', { name: /Target price/i })
    await userEvent.clear(target)
    await userEvent.type(target, '25')
    await userEvent.click(screen.getByRole('button', { name: 'Save alert' }))
    expect(context.saveAlert).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'B0GHY4PR3N', threshold: 25 }),
    )
    expect(mutations).toHaveLength(0)
  })
})
