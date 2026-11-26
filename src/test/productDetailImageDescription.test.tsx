import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Headphones } from 'lucide-react'
import { AuthProvider } from '../auth/AuthProvider'
import { AppLayout } from '../components/layout/AppLayout'
import type { DemoProduct } from '../data/products'
import { ProductDetailPage } from '../pages/ProductDetailPage'

const currentUser = {
  id: 'user-1',
  email: 'user@example.test',
  username: 'Test User',
  role: 'User' as const,
  status: 'Active' as const,
  registeredAt: '2026-01-01T00:00:00.000Z',
}

const SHORT_DESCRIPTION =
  'Wireless noise-canceling headphones with up to 30 hours of battery life.'
const LONG_DESCRIPTION = `${'Detailed product information '.repeat(40)}\n${'X'.repeat(600)}`

function makeProduct(description: string, imageUrl?: string): DemoProduct {
  return {
    id: 'detail-product-1',
    name: 'Detail Product One',
    brand: 'Example',
    category: 'Audio',
    store: 'Amazon',
    price: 328,
    previousPrice: 379.99,
    updated: '12 min ago',
    updatedAt: '2026-11-19T12:00:00Z',
    specifications: [
      { label: 'Model', value: 'DP-1' },
      { label: 'Description', value: description },
    ],
    icon: Headphones,
    tone: 'text-blue-200 from-blue-400/20 to-blue-500/5',
    ...(imageUrl ? { imageUrl } : {}),
  }
}

function makeProductWithAvailability(value: string): DemoProduct {
  const product = makeProduct(SHORT_DESCRIPTION)
  return {
    ...product,
    specifications: [
      ...product.specifications,
      { label: 'Availability', value },
    ],
  }
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}

type BackendOffer = {
  store: string
  price: number
  availability?: string | null
  source_type?: string | null
  verification_status?: string | null
  is_test_site?: boolean
}

type BackendHistory = {
  store: string
  points: { date: string; price: number }[]
  availability?: string | null
  verification_status?: string | null
  is_test_site?: boolean
}

type BackendOptions = {
  offers?: BackendOffer[]
  history?: BackendHistory[]
  failPriceData?: boolean
  delayPriceData?: number
}

function mockBackend(
  product: DemoProduct,
  apiImageUrl?: string | null,
  options: BackendOptions = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const method = init?.method ?? 'GET'

      if (url.pathname === '/api/auth/session') return jsonResponse(null)
      if (url.pathname === '/api/health') {
        return jsonResponse({ status: 'ok', database: 'connected' })
      }
      if (url.pathname === '/api/products') {
        return jsonResponse([
          {
            id: product.id,
            name: product.name,
            brand: product.brand,
            category: product.category,
            store: product.store,
            price: product.price,
            previousPrice: product.previousPrice,
            updated: product.updated,
            updatedAt: product.updatedAt,
            specifications: product.specifications,
            tone: product.tone,
            ...(apiImageUrl !== undefined ? { image_url: apiImageUrl } : {}),
          },
        ])
      }
      if (/\/offers$/.test(url.pathname)) {
        if (options.failPriceData) {
          return jsonResponse({ detail: 'price data offline' }, 500)
        }
        if (options.delayPriceData) {
          await new Promise((resolve) => setTimeout(resolve, options.delayPriceData))
        }
        return jsonResponse(
          (options.offers ?? []).map((offer) => ({
            availability: 'in_stock',
            source_type: 'scraped',
            verification_status: 'verified_scraped',
            is_test_site: false,
            ...offer,
          })),
        )
      }
      if (/\/history$/.test(url.pathname)) {
        if (options.failPriceData) {
          return jsonResponse({ detail: 'price data offline' }, 500)
        }
        if (options.delayPriceData) {
          await new Promise((resolve) => setTimeout(resolve, options.delayPriceData))
        }
        return jsonResponse(
          (options.history ?? []).map((history) => ({
            availability: 'in_stock',
            verification_status: 'verified_scraped',
            is_test_site: false,
            ...history,
          })),
        )
      }
      if (/\/channel3$/.test(url.pathname)) return jsonResponse({ product: null })
      if (url.pathname === '/api/alerts' && method === 'GET') {
        return jsonResponse([])
      }
      if (url.pathname === '/api/alerts' && method === 'POST') {
        return jsonResponse(JSON.parse(String(init?.body ?? '{}')), 201)
      }
      if (url.pathname === '/api/watchlist' && method === 'GET') {
        return jsonResponse([])
      }
      const watchlistMatch = url.pathname.match(/^\/api\/watchlist\/([^/]+)$/)
      if (watchlistMatch && method === 'PUT') {
        return jsonResponse({
          productId: decodeURIComponent(watchlistMatch[1]),
          addedAt: '2026-11-19T00:00:00Z',
        })
      }
      if (watchlistMatch && method === 'DELETE') return jsonResponse(null)
      if (url.pathname === '/api/notifications' && method === 'GET') {
        return jsonResponse([])
      }
      return jsonResponse([])
    }),
  )
}

function renderDetail(
  product: DemoProduct,
  apiImageUrl?: string | null,
  options: BackendOptions = {},
) {
  mockBackend(product, apiImageUrl, options)
  return render(
    <MemoryRouter initialEntries={[`/products/${product.id}`]}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<AppLayout currentUser={currentUser} />}>
            <Route path="products/:id" element={<ProductDetailPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

async function waitForDetail() {
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: 'Detail Product One' }),
    ).toBeDefined(),
  )
}

function descriptionSection() {
  return screen.getByRole('region', { name: 'Product description' })
}

describe('Product Detail image and description layout', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the real backend image_url with contain sizing and a fixed responsive frame', async () => {
    renderDetail(
      makeProduct(SHORT_DESCRIPTION),
      'https://example.test/images/detail-product.jpg',
    )
    await waitForDetail()

    const image = screen.getByAltText('Detail Product One product image')
    expect(image.getAttribute('src')).toBe(
      'https://example.test/images/detail-product.jpg',
    )
    expect(image.className).toContain('object-contain')

    const frame = image.parentElement?.parentElement
    expect(frame?.className).toContain('aspect-square')
    expect(frame?.className).toContain('w-full')
    expect(frame?.className).toContain('max-w-[360px]')
    expect(frame?.className).toContain('mx-auto')
  })

  it('shows a placeholder when no image is available and recovers from broken URLs', async () => {
    const { unmount } = renderDetail(makeProduct(SHORT_DESCRIPTION), null)
    await waitForDetail()

    expect(screen.queryByAltText('Detail Product One product image')).toBeNull()
    expect(
      screen.getAllByRole('img', { name: 'Detail Product One product image' })
        .length,
    ).toBeGreaterThan(0)
    unmount()

    renderDetail(
      makeProduct(SHORT_DESCRIPTION),
      'https://example.test/images/missing.jpg',
    )
    await waitForDetail()

    const image = screen.getByAltText('Detail Product One product image')
    fireEvent.error(image)
    expect(screen.queryByAltText('Detail Product One product image')).toBeNull()
    expect(
      screen.getAllByRole('img', { name: 'Detail Product One product image' })
        .length,
    ).toBeGreaterThan(0)
  })

  it('ignores invalid image URLs instead of rendering a broken image', async () => {
    renderDetail(makeProduct(SHORT_DESCRIPTION), 'javascript:alert(1)')
    await waitForDetail()

    expect(screen.queryByAltText('Detail Product One product image')).toBeNull()
    expect(
      screen.getAllByRole('img', { name: 'Detail Product One product image' })
        .length,
    ).toBeGreaterThan(0)
  })

  it('keeps short descriptions in a constrained, scrollable box', async () => {
    renderDetail(makeProduct(SHORT_DESCRIPTION))
    await waitForDetail()

    const section = descriptionSection()
    expect(section.className).toContain('w-full')
    expect(section.className).toContain('max-w-3xl')
    expect(within(section).getByText(SHORT_DESCRIPTION)).toBeDefined()

    const scroller = within(section).getByTestId('product-description-scroll')
    expect(scroller.className).toContain('max-h-40')
    expect(scroller.className).toContain('overflow-y-auto')
    expect(scroller.className).toContain('overflow-x-hidden')
    expect(scroller.className).toContain('break-words')
    expect(scroller.className).toContain('p-4')
    expect(scroller.className).toContain('leading-6')
  })

  it('preserves very long descriptions without expanding the box horizontally', async () => {
    renderDetail(makeProduct(LONG_DESCRIPTION))
    await waitForDetail()

    const section = descriptionSection()
    expect(section.className).toContain('w-full')
    expect(section.className).toContain('max-w-3xl')
    expect(section.textContent).toContain(LONG_DESCRIPTION.slice(0, 120))
    expect(section.textContent).toContain('X'.repeat(600))

    const scroller = within(section).getByTestId('product-description-scroll')
    expect(scroller.className).toContain('h-40')
    expect(scroller.className).toContain('overflow-y-auto')
    expect(scroller.className).toContain('overflow-x-hidden')
    expect(scroller.className).toContain('[overflow-wrap:anywhere]')

    const specifications = screen.getByRole('region', {
      name: 'Product specifications',
    })
    expect(within(specifications).queryByText('Description')).toBeNull()
    expect(within(specifications).getByText('Model')).toBeDefined()
  })

  it('shows real store offers and price history with the lowest offer highlighted', async () => {
    renderDetail(makeProduct(SHORT_DESCRIPTION), null, {
      offers: [
        { store: 'Amazon', price: 328 },
        { store: 'Best Buy', price: 299 },
      ],
      history: [
        {
          store: 'Amazon',
          points: [
            { date: '2026-11-01', price: 340 },
            { date: '2026-11-02', price: 328 },
          ],
        },
        {
          store: 'Best Buy',
          points: [
            { date: '2026-11-01', price: 310 },
            { date: '2026-11-02', price: 299 },
          ],
        },
      ],
    })
    await waitForDetail()

    const offers = screen.getByRole('region', { name: 'Prices across stores' })
    await waitFor(() => expect(within(offers).getByText('Best Buy')).toBeDefined())
    expect(within(offers).getAllByText('Best price')).toHaveLength(1)
    expect(within(offers).getByText('$299.00')).toBeDefined()
    expect(within(offers).getByText('$29.00 above best price')).toBeDefined()

    const history = screen.getByRole('region', { name: 'Price history' })
    await waitFor(() =>
      expect(within(history).getByText('Lowest price')).toBeDefined(),
    )
    expect(within(history).getByText('Highest price')).toBeDefined()
    expect(within(history).getByText('Average price')).toBeDefined()

    const sevenDays = within(history).getByRole('button', { name: '7D' })
    expect(sevenDays.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(sevenDays)
    expect(sevenDays.getAttribute('aria-pressed')).toBe('true')
  })

  it('uses only canonical In Stock offers for sorting and the best-price panel', async () => {
    renderDetail(makeProduct(SHORT_DESCRIPTION), null, {
      offers: [
        { store: 'Amazon', price: 328 },
        {
          store: 'Cheap Out',
          price: 10,
          availability: 'out_of_stock',
          verification_status: 'unverified_excluded',
        },
        {
          store: 'WebScraper.io Test Site',
          price: 1,
          verification_status: 'test_site_illustrative',
          is_test_site: true,
        },
      ],
      history: [
        {
          store: 'Amazon',
          points: [{ date: '2026-11-01', price: 340 }],
        },
        {
          store: 'Cheap Out',
          points: [{ date: '2026-11-01', price: 10 }],
          availability: 'out_of_stock',
        },
      ],
    })
    await waitForDetail()

    const offers = screen.getByRole('region', { name: 'Prices across stores' })
    await waitFor(() => expect(within(offers).getByText('Amazon')).toBeDefined())
    expect(within(offers).queryByText('Cheap Out')).toBeNull()
    expect(within(offers).queryByText('WebScraper.io Test Site')).toBeNull()
    expect(within(offers).getByText('In Stock')).toBeDefined()
    expect(within(offers).getByText('Scraped')).toBeDefined()
    expect(within(offers).getByText('Verified scraped')).toBeDefined()
    expect(screen.getByText('Cheapest store')).toBeDefined()

    const history = screen.getByRole('region', { name: 'Price history' })
    await waitFor(() =>
      expect(within(history).getByText('Lowest price')).toBeDefined(),
    )
    expect(within(history).queryByText('$10.00')).toBeNull()
  })

  it('excludes ineligible manual offers from best-price calculations', async () => {
    renderDetail(makeProduct(SHORT_DESCRIPTION), null, {
      offers: [
        {
          store: 'Valid Manual',
          price: 120,
          source_type: 'manual',
          verification_status: 'manually_verified',
        },
        {
          store: 'Ineligible Manual',
          price: 10,
          source_type: 'manual',
          verification_status: 'manual_illustrative',
        },
      ],
    })
    await waitForDetail()

    const offers = screen.getByRole('region', { name: 'Prices across stores' })
    await waitFor(() => expect(within(offers).getByText('Valid Manual')).toBeDefined())
    expect(within(offers).getByText('Ineligible Manual')).toBeDefined()
    expect(within(offers).getByText('Lowest verified offer')).toBeDefined()

    const bestBadges = within(offers).getAllByText('Best price')
    expect(bestBadges).toHaveLength(1)
    expect(bestBadges[0].closest('article')?.textContent).toContain('Valid Manual')
  })

  it('distinguishes illustrative-only, unavailable-only, and no-offer empty states', async () => {
    const { unmount } = renderDetail(makeProduct(SHORT_DESCRIPTION), null, {
      offers: [
        {
          store: 'Manual Listing',
          price: 5,
          availability: 'unknown',
          source_type: 'manual',
          verification_status: 'manual_illustrative',
        },
      ],
    })
    await waitForDetail()
    expect(
      await screen.findByText('Only illustrative/test-site data is available'),
    ).toBeDefined()
    expect(screen.queryByText('Cheapest store')).toBeNull()
    unmount()

    renderDetail(makeProduct(SHORT_DESCRIPTION), null, {
      offers: [
        {
          store: 'Amazon',
          price: 328,
          availability: 'out_of_stock',
          verification_status: 'unverified_excluded',
        },
      ],
    })
    await waitForDetail()
    expect(
      await screen.findByText('No In Stock offers match these filters'),
    ).toBeDefined()
  })

  it('does not treat Unavailable as an in-stock product', async () => {
    renderDetail(makeProductWithAvailability('Unavailable'), null, {
      offers: [{ store: 'Amazon', price: 328 }],
    })
    await waitForDetail()

    const badge = screen
      .getAllByText('Unavailable')
      .map((element) => element.closest('span'))
      .find((element) => element?.className.includes('border-amber-400/20'))
    expect(badge).toBeDefined()
    const offers = screen.getByRole('region', { name: 'Prices across stores' })
    await waitFor(() => expect(within(offers).getByText('Amazon')).toBeDefined())
  })

  it('requests availability-scoped offers and history from the backend', async () => {
    renderDetail(makeProduct(SHORT_DESCRIPTION), null, {
      offers: [{ store: 'Amazon', price: 328 }],
    })
    await waitForDetail()

    const requested = vi.mocked(fetch).mock.calls.map(([input]) => String(input))
    expect(
      requested.some((url) =>
        url.includes('/offers?availability=in_stock'),
      ),
    ).toBe(true)
    expect(
      requested.some((url) =>
        url.includes('/history?period=30D&availability=in_stock'),
      ),
    ).toBe(true)
  })

  it('shows loading and then empty states without getting stuck', async () => {
    renderDetail(makeProduct(SHORT_DESCRIPTION), null, {
      delayPriceData: 120,
    })
    await waitForDetail()

    expect(
      screen.getByRole('status', { name: 'Loading price history' }),
    ).toBeDefined()
    expect(screen.getByText('Loading current store offers…')).toBeDefined()

    await waitFor(
      () =>
        expect(
          screen.queryByRole('status', { name: 'Loading price history' }),
        ).toBeNull(),
      { timeout: 2000 },
    )
    expect(screen.getByText('No offers found')).toBeDefined()
    expect(
      screen.getByText('No recorded price history is available for this range.'),
    ).toBeDefined()
  })

  it('shows proper error states for unavailable price data', async () => {
    renderDetail(makeProduct(SHORT_DESCRIPTION), null, {
      failPriceData: true,
    })
    await waitForDetail()

    await waitFor(() =>
      expect(screen.getByText("Offers couldn't load")).toBeDefined(),
    )
    expect(screen.getByText("Price history couldn't load")).toBeDefined()
    expect(screen.getAllByText('price data offline').length).toBeGreaterThan(0)
  })

  it('preserves watchlist and price alert actions', async () => {
    renderDetail(makeProduct(SHORT_DESCRIPTION))
    await waitForDetail()

    fireEvent.click(screen.getByRole('button', { name: 'Add to Watchlist' }))
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Saved to Watchlist' })
          .getAttribute('aria-pressed'),
      ).toBe('true'),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Create Price Alert' }))
    const dialog = screen.getByRole('dialog', { name: 'Create alert' })
    const threshold = within(dialog).getByLabelText(/Target price/)
    fireEvent.change(threshold, { target: { value: '250' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create alert' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

const responsiveViewports = [320, 375, 430, 768, 820, 1024, 1280, 1440]

describe('Product Detail responsive layout tokens', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each(responsiveViewports)(
    'uses overflow-safe responsive structure at %ipx',
    async (width) => {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: width,
      })

      renderDetail(
        makeProduct(LONG_DESCRIPTION),
        'https://example.test/images/detail-product.jpg',
        {
          offers: [{ store: 'Amazon', price: 328 }],
          history: [
            {
              store: 'Amazon',
              points: [
                { date: '2026-11-01', price: 340 },
                { date: '2026-11-02', price: 328 },
              ],
            },
          ],
        },
      )
      await waitForDetail()

      const page = screen
        .getByRole('heading', { name: 'Detail Product One' })
        .closest('div.relative.mx-auto')
      expect(page?.className).toContain('min-w-0')
      expect(page?.className).toContain('max-w-6xl')
      expect(page?.className).toContain('overflow-x-hidden')

      const heroGrid = screen
        .getByRole('heading', { name: 'Detail Product One' })
        .closest('div.grid')
      expect(heroGrid?.className).toContain('grid-cols-1')
      expect(heroGrid?.className).toContain('md:grid-cols-')
      expect(heroGrid?.className).toContain('lg:grid-cols-')

      const image = screen.getByAltText('Detail Product One product image')
      const imageFrame = image.parentElement?.parentElement
      expect(image.className).toContain('max-w-full')
      expect(image.className).toContain('object-contain')
      expect(imageFrame?.className).toContain('aspect-square')
      expect(imageFrame?.className).toContain('w-full')
      expect(imageFrame?.className).toContain('max-w-[360px]')

      const title = screen.getByRole('heading', { name: 'Detail Product One' })
      expect(title.className).toContain('break-words')

      const watchlist = screen.getByRole('button', { name: 'Add to Watchlist' })
      expect(watchlist.className).toContain('min-h-11')
      expect(watchlist.className).toContain('w-full')
      expect(watchlist.className).toContain('sm:w-auto')

      const scroller = screen.getByTestId('product-description-scroll')
      expect(scroller.className).toContain('h-40')
      expect(scroller.className).toContain('overflow-y-auto')
      expect(scroller.className).toContain('overflow-x-hidden')

      expect(document.querySelector('table')).toBeNull()
      expect(page?.getAttribute('style') ?? '').not.toMatch(/width\s*:/)

      const chartFrame = await waitFor(() => {
        const frame = screen
          .getByRole('region', { name: 'Price history' })
          .querySelector('div.h-\\[280px\\]')
        expect(frame).not.toBeNull()
        return frame
      })
      expect(chartFrame?.className).toContain('w-full')
      expect(chartFrame?.className).toContain('min-w-0')
      expect(chartFrame?.className).toContain('max-w-full')
    },
  )
})
