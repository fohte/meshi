// Converts the MEXT food composition table (日本食品標準成分表), distributed
// as an .xlsx workbook, into the JSON shape `pnpm seed --food-composition`
// expects. The source Excel is not bundled (see README's "Food composition
// table" section for why) so this reads the .xlsx file directly.
//
// The header spans multiple rows with merged cells, so columns are located
// by matching the *combined* header text (all header rows for a column,
// concatenated) against known Japanese nutrient labels rather than by fixed
// column position — a shifted/reordered column just fails to match instead
// of silently reading the wrong data. Run with --dump-header first to see
// what each column resolved to.

import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

import { err, ok, type Result, ResultAsync } from 'neverthrow'
import { readSheet } from 'read-excel-file/node'

import { parseFoodCompositionDataset } from '#db/seed/food-composition'
import { type NutrientCode } from '#db/seed/nutrient-definitions'

export class ConvertError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConvertError'
  }
}

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e)

// read-excel-file returns each cell as string | number | Date | null. Widen
// everything to a string so the rest of the pipeline (which came from
// parsing CSV text) doesn't need to know the difference — a numeric food
// code cell and a text one both end up as the same digit string, and NFKC
// normalization still matters for full-width headers/values some MEXT
// workbooks use.
export const cellToString = (cell: unknown): string => {
  if (cell === null || cell === undefined) return ''
  if (cell instanceof Date) return cell.toISOString()
  if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell)
  if (typeof cell === 'string') return cell.normalize('NFKC')
  return ''
}

export const readXlsxRows = (
  xlsxPath: string,
  sheet: string | number,
): ResultAsync<string[][], ConvertError> =>
  ResultAsync.fromPromise(
    readSheet(xlsxPath, sheet),
    (caughtErr): ConvertError =>
      new ConvertError(
        `failed to read ${xlsxPath} (sheet ${String(sheet)}): ${errorMessage(caughtErr)}`,
      ),
  ).map((rows) => rows.map((row) => row.map(cellToString)))

export const columnLetter = (index: number): string => {
  let n = index + 1
  let letters = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

// MEXT pads short header labels with inter-character full-width spaces for
// visual justification (e.g. "食　品　名"), and wraps long ones with a
// literal \r\n inside a single cell — neither carries meaning, so all
// whitespace is stripped rather than just trimmed off the ends.
export const combineHeader = (
  headerRows: ReadonlyArray<ReadonlyArray<string>>,
  columnIndex: number,
): string =>
  headerRows
    .map((row) => (row[columnIndex] ?? '').replace(/\s+/g, ''))
    .filter((cell) => cell.length > 0)
    .join('')

// Column indices in `headers` whose text satisfies `test`. Shared by
// `findColumn` (single required column) and the nutrient-matcher loop below
// (many optional columns) so both branch on the same "how many columns
// matched" question — 0 (not found), 1 (resolved), or 2+ (ambiguous).
const matchColumnIndices = (
  headers: ReadonlyArray<string>,
  test: (header: string) => boolean,
): number[] => headers.map((h, i) => (test(h) ? i : -1)).filter((i) => i >= 0)

interface NutrientMatcher {
  readonly code: NutrientCode
  readonly test: (header: string) => boolean
}

// Only nutrients that live in the general-components table (一般成分表) are
// mapped. saturated_fat_g (per-fatty-acid breakdown table) and vitamin_e_mg
// (four separate tocopherol columns, no single total) live in other MEXT
// tables and are intentionally left unmatched.
const NUTRIENT_MATCHERS: ReadonlyArray<NutrientMatcher> = [
  // "エネルギー" merges across the kJ/kcal column pair, so only the leftmost
  // (kJ) column's combined header actually contains that text — the kcal
  // column is distinguishable only by its own "単位" (unit) row, "kcal".
  {
    code: 'energy_kcal',
    test: (h) => h.includes('kcal'),
  },
  {
    code: 'protein_g',
    test: (h) => h.includes('たんぱく質') && !h.includes('アミノ酸'),
  },
  { code: 'fat_g', test: (h) => h.includes('脂質') && !h.includes('脂肪酸') },
  {
    code: 'carb_g',
    test: (h) =>
      h.includes('炭水化物') &&
      !h.includes('利用可能') &&
      !h.includes('食物繊維') &&
      !h.includes('差引き'),
  },
  { code: 'dietary_fiber_g', test: (h) => h.includes('食物繊維総量') },
  { code: 'salt_g', test: (h) => h.includes('食塩相当量') },
  { code: 'cholesterol_mg', test: (h) => h.includes('コレステロール') },
  { code: 'sodium_mg', test: (h) => h.includes('ナトリウム') },
  { code: 'potassium_mg', test: (h) => h.includes('カリウム') },
  { code: 'calcium_mg', test: (h) => h.includes('カルシウム') },
  { code: 'magnesium_mg', test: (h) => h.includes('マグネシウム') },
  { code: 'phosphorus_mg', test: (h) => h.includes('リン') },
  { code: 'iron_mg', test: (h) => h.includes('鉄') },
  { code: 'zinc_mg', test: (h) => h.includes('亜鉛') },
  { code: 'copper_mg', test: (h) => h.includes('銅') },
  { code: 'vitamin_a_µg', test: (h) => h.includes('レチノール活性当量') },
  { code: 'vitamin_d_µg', test: (h) => h.includes('ビタミンD') },
  { code: 'vitamin_k_µg', test: (h) => h.includes('ビタミンK') },
  { code: 'vitamin_b1_mg', test: (h) => /ビタミンB1(?!\d)/.test(h) },
  { code: 'vitamin_b2_mg', test: (h) => h.includes('ビタミンB2') },
  {
    code: 'niacin_mg',
    test: (h) => h.includes('ナイアシン') && !h.includes('当量'),
  },
  { code: 'vitamin_b6_mg', test: (h) => h.includes('ビタミンB6') },
  { code: 'vitamin_b12_µg', test: (h) => h.includes('ビタミンB12') },
  { code: 'folate_µg', test: (h) => h.includes('葉酸') },
  { code: 'pantothenic_acid_mg', test: (h) => h.includes('パントテン酸') },
  { code: 'biotin_µg', test: (h) => h.includes('ビオチン') },
  { code: 'vitamin_c_mg', test: (h) => h.includes('ビタミンC') },
]

export interface ResolvedColumns {
  readonly codeColumn: number
  readonly nameColumn: number
  readonly nutrientColumns: ReadonlyMap<number, NutrientCode>
  // No column's header text matched this nutrient's pattern at all.
  readonly unmatchedNutrientCodes: ReadonlyArray<NutrientCode>
  // 2+ columns matched — the pattern needs a tighter exclusion, distinct
  // from unmatchedNutrientCodes so --dump-header can tell "not in this
  // table" apart from "found it twice, matcher needs fixing".
  readonly ambiguousNutrientCodes: ReadonlyArray<NutrientCode>
}

const findColumn = (
  headers: ReadonlyArray<string>,
  test: (header: string) => boolean,
  label: string,
): Result<number, ConvertError> => {
  const matches = matchColumnIndices(headers, test)
  const [only, ...rest] = matches
  if (only === undefined) {
    return err(new ConvertError(`no column matched ${label}`))
  }
  if (rest.length > 0) {
    return err(
      new ConvertError(
        `ambiguous columns for ${label}: ${matches.map(columnLetter).join(', ')}`,
      ),
    )
  }
  return ok(only)
}

export const resolveColumns = (
  headerRows: ReadonlyArray<ReadonlyArray<string>>,
  columnCount: number,
): Result<ResolvedColumns, ConvertError> => {
  const headers = Array.from({ length: columnCount }, (_, i) =>
    combineHeader(headerRows, i),
  )

  const codeColumnResult = findColumn(
    headers,
    (h) => h.includes('食品番号'),
    '食品番号',
  )
  if (codeColumnResult.isErr()) return err(codeColumnResult.error)
  const nameColumnResult = findColumn(
    headers,
    (h) => h.includes('食品名'),
    '食品名',
  )
  if (nameColumnResult.isErr()) return err(nameColumnResult.error)

  const nutrientColumns = new Map<number, NutrientCode>()
  const unmatchedNutrientCodes: NutrientCode[] = []
  const ambiguousNutrientCodes: NutrientCode[] = []
  for (const matcher of NUTRIENT_MATCHERS) {
    const matches = matchColumnIndices(headers, matcher.test)
    const [only, ...rest] = matches
    if (only !== undefined && rest.length === 0) {
      nutrientColumns.set(only, matcher.code)
    } else if (matches.length > 0) {
      ambiguousNutrientCodes.push(matcher.code)
    } else {
      unmatchedNutrientCodes.push(matcher.code)
    }
  }

  return ok({
    codeColumn: codeColumnResult.value,
    nameColumn: nameColumnResult.value,
    nutrientColumns,
    unmatchedNutrientCodes,
    ambiguousNutrientCodes,
  })
}

// Handles the table's measurement-status symbols: "-" (not measured, dropped
// from the row entirely), "Tr" (trace, recorded as 0), and "(2.5)" /
// "(Tr)" (estimated value, parens stripped before the same handling).
export const parseNutrientValue = (raw: string): number | undefined => {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '-') return undefined
  const unwrapped = /^\((.+)\)$/.exec(trimmed)?.[1]?.trim() ?? trimmed
  if (unwrapped === 'Tr' || unwrapped === 'tr') return 0
  const n = Number(unwrapped)
  return Number.isFinite(n) ? n : undefined
}

export interface FoodCompositionRowInput {
  readonly code: string
  readonly name: string
  readonly nutrients: Record<string, number>
}

export interface BuildRowsResult {
  readonly rows: ReadonlyArray<FoodCompositionRowInput>
  readonly warnings: ReadonlyArray<string>
}

export const buildRows = (
  dataRows: ReadonlyArray<ReadonlyArray<string>>,
  columns: ResolvedColumns,
): BuildRowsResult => {
  const rows: FoodCompositionRowInput[] = []
  const warnings: string[] = []

  for (const row of dataRows) {
    const rawCode = (row[columns.codeColumn] ?? '').trim()
    // Non-numeric first-column cells are food-group header rows (e.g. "1
    // 穀類") or blank separator rows in the official table, not food rows.
    if (!/^\d{1,5}$/.test(rawCode)) continue
    const code = rawCode.padStart(5, '0')

    const name = (row[columns.nameColumn] ?? '').trim()
    if (name === '') {
      warnings.push(`skipped food code ${code}: empty name`)
      continue
    }

    const nutrients: Record<string, number> = {}
    for (const [colIndex, nutrientCode] of columns.nutrientColumns) {
      const raw = row[colIndex] ?? ''
      const value = parseNutrientValue(raw)
      if (value === undefined) {
        const trimmed = raw.trim()
        if (trimmed !== '' && trimmed !== '-') {
          warnings.push(
            `food ${code}: unparseable value "${trimmed}" for ${nutrientCode}, skipped`,
          )
        }
        continue
      }
      nutrients[nutrientCode] = value
    }

    rows.push({ code, name, nutrients })
  }

  return { rows, warnings }
}

interface CliArgs {
  readonly xlsx: string
  readonly sheet: string | number
  readonly out: string | undefined
  readonly headerRows: number
  readonly dumpHeader: boolean
}

const printUsage = (): void => {
  console.error(
    'usage: convert-food-composition --xlsx <path> (--out <path> | --dump-header) [--header-rows N] [--sheet <name-or-1-based-index>]',
  )
}

// A numeric --sheet value selects by 1-based index; anything else is looked
// up by sheet name — read-excel-file distinguishes the two by JS type, not
// by content, so a numeric-looking string has to be converted to a number.
const parseSheetArg = (raw: string): string | number => {
  const n = Number(raw)
  return raw.trim() !== '' && Number.isInteger(n) ? n : raw
}

// Verified against the actual 日本食品標準成分表(八訂)増補2023年 workbook's
// "表全体" sheet: group label / item label / sub-item label rows, then a
// "単位" (unit) row and a "成分識別子" (component tag) row before the data
// starts — 12 rows total. --dump-header confirms it for any other release.
const DEFAULT_HEADER_ROWS = '12'

const parseCliArgs = (): CliArgs => {
  const { values } = parseArgs({
    options: {
      xlsx: { type: 'string' },
      sheet: { type: 'string', default: '1' },
      out: { type: 'string' },
      'header-rows': { type: 'string' },
      'dump-header': { type: 'boolean', default: false },
    },
  })
  if (values.xlsx === undefined) {
    printUsage()
    process.exit(1)
  }
  const headerRowsRaw = values['header-rows'] ?? DEFAULT_HEADER_ROWS
  const headerRows = Number(headerRowsRaw)
  if (!Number.isInteger(headerRows) || headerRows < 0) {
    console.error(
      `--header-rows must be a non-negative integer (got: ${headerRowsRaw})`,
    )
    process.exit(1)
  }
  return {
    xlsx: values.xlsx,
    sheet: parseSheetArg(values.sheet),
    out: values.out,
    headerRows,
    dumpHeader: values['dump-header'],
  }
}

const summarizeUnresolvedNutrients = (columns: ResolvedColumns): string =>
  `${String(columns.unmatchedNutrientCodes.length)} unmatched (${columns.unmatchedNutrientCodes.join(', ') || 'none'}), ` +
  `${String(columns.ambiguousNutrientCodes.length)} ambiguous (${columns.ambiguousNutrientCodes.join(', ') || 'none'})`

const main = async (): Promise<void> => {
  const args = parseCliArgs()
  const rowsResult = await readXlsxRows(args.xlsx, args.sheet)
  if (rowsResult.isErr()) {
    console.error(rowsResult.error.message)
    process.exit(1)
  }
  const rows = rowsResult.value
  if (rows.length === 0) {
    console.error(`${args.xlsx} (sheet ${String(args.sheet)}) is empty`)
    process.exit(1)
  }

  const headerRows = rows.slice(0, args.headerRows)
  const columnCount = Math.max(...rows.map((r) => r.length))

  const columnsResult = resolveColumns(headerRows, columnCount)
  if (columnsResult.isErr()) {
    console.error(columnsResult.error.message)
    process.exit(1)
  }
  const columns = columnsResult.value

  if (args.dumpHeader) {
    for (let i = 0; i < columnCount; i++) {
      const header = combineHeader(headerRows, i)
      const mapped = columns.nutrientColumns.get(i)
      const role =
        i === columns.codeColumn
          ? ' [code]'
          : i === columns.nameColumn
            ? ' [name]'
            : mapped !== undefined
              ? ` [${mapped}]`
              : ''
      console.log(`${columnLetter(i)}: ${header}${role}`)
    }
    console.log(
      `unresolved nutrient codes: ${summarizeUnresolvedNutrients(columns)}`,
    )
    return
  }

  if (args.out === undefined) {
    printUsage()
    process.exit(1)
  }
  const out = args.out

  const dataRows = rows.slice(args.headerRows)
  const { rows: builtRows, warnings } = buildRows(dataRows, columns)
  for (const warning of warnings) console.warn(warning)

  const datasetResult = parseFoodCompositionDataset(builtRows)
  if (datasetResult.isErr()) {
    console.error(datasetResult.error.message)
    process.exit(1)
  }

  await writeFile(out, JSON.stringify(datasetResult.value, null, 2))
  console.log(
    `wrote ${String(datasetResult.value.length)} of ${String(dataRows.length)} scanned rows ` +
      `to ${out} (nutrient codes: ${summarizeUnresolvedNutrients(columns)})`,
  )
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  main().catch((e: unknown) => {
    console.error(e)
    process.exit(1)
  })
}
