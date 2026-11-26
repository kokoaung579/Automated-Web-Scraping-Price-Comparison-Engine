import type { DemoProduct } from './products'

function matchesDatabaseProduct(
  databaseProduct: DemoProduct,
  channel3Product: DemoProduct,
) {
  const normalizedName = (value: string) =>
    value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '')
  const databaseName = normalizedName(databaseProduct.name)
  const channel3Name = normalizedName(channel3Product.name)
  const databaseBrand = normalizedName(databaseProduct.brand)
  const channel3Brand = normalizedName(channel3Product.brand)

  return (
    (channel3Brand === databaseBrand ||
      channel3Name.includes(databaseBrand)) &&
    (channel3Name.includes(databaseName) ||
      databaseName.includes(channel3Name))
  )
}

export function mergeCatalogProducts(
  databaseProducts: DemoProduct[],
  channel3Products: DemoProduct[],
): DemoProduct[] {
  const matchedChannel3Ids = new Set<string>()
  const catalogProducts = databaseProducts.map((databaseProduct) => {
    const channel3Product = channel3Products.find((candidate) =>
      matchesDatabaseProduct(databaseProduct, candidate),
    )
    if (channel3Product) matchedChannel3Ids.add(channel3Product.id)
    return databaseProduct
  })

  return [
    ...catalogProducts,
    ...channel3Products.filter(
      (channel3Product) => !matchedChannel3Ids.has(channel3Product.id),
    ),
  ]
}
