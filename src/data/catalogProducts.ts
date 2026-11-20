import type { DemoProduct } from './products'

function matchesDatabaseProduct(
  databaseProduct: DemoProduct,
  channel3Product: DemoProduct,
) {
  const normalize = (value: string, compact = false) => {
    const normalized = value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase()
    return compact
      ? normalized.replace(/[^a-z0-9]/g, '')
      : normalized.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
  }
  const getModel = (product: DemoProduct) =>
    product.specifications.find(
      (specification) => specification.label.trim().toLocaleLowerCase() === 'model',
    )?.value ?? ''

  const databaseValues = [
    normalize(databaseProduct.name),
    normalize(databaseProduct.brand, true),
    normalize(getModel(databaseProduct), true),
    normalize(databaseProduct.category),
  ]
  const channel3Values = [
    normalize(channel3Product.name),
    normalize(channel3Product.brand, true),
    normalize(getModel(channel3Product), true),
    normalize(channel3Product.category),
  ]
  return (
    databaseValues.every(Boolean) &&
    channel3Values.every(Boolean) &&
    databaseValues.every((value, index) => value === channel3Values[index])
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
