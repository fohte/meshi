export const formatNutrientValue = (value: number, unit: string): string => {
  const decimals = unit === 'kcal' || unit === 'µg' ? 0 : 1
  return `${value.toFixed(decimals)} ${unit}`
}
