declare module "pdf-parse"

declare module "papaparse" {
  namespace Papa {
    interface ParseMeta {
      fields?: string[]
      delimiter: string
      linebreak: string
      aborted: boolean
      truncated: boolean
      cursor: number
    }

    interface ParseError {
      type: string
      code: string
      message: string
      row?: number
    }

    interface ParseResult<T> {
      data: T[]
      errors: ParseError[]
      meta: ParseMeta
    }

    interface ParseConfig<T = any> {
      header?: boolean
      skipEmptyLines?: boolean | "greedy"
      complete?: (results: ParseResult<T>) => void
      error?: (error: ParseError) => void
      [key: string]: any
    }

    function parse<T = any>(input: string, config?: ParseConfig<T>): ParseResult<T>
  }

  export = Papa
}
