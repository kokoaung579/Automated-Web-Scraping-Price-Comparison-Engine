export const PRODUCT_PAGE_SIZES = [10, 20, 50] as const
export type ProductPageSize = (typeof PRODUCT_PAGE_SIZES)[number]
export const DEFAULT_PRODUCT_PAGE_SIZE: ProductPageSize = 10

export function isProductPageSize(value: string): value is `${ProductPageSize}` {
  return PRODUCT_PAGE_SIZES.some((size) => String(size) === value)
}

export function getProductPageItems(
  currentPage: number,
  totalPages: number,
): (number | 'ellipsis')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  const pages: (number | 'ellipsis')[] = [1]
  const start = Math.max(2, currentPage - 1)
  const end = Math.min(totalPages - 1, currentPage + 1)

  if (start > 2) pages.push('ellipsis')
  for (let page = start; page <= end; page += 1) pages.push(page)
  if (end < totalPages - 1) pages.push('ellipsis')
  pages.push(totalPages)
  return pages
}
