declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css'

declare module '*.png' {
  const url: string
  export default url
}

declare module '*.css?inline' {
  const css: string
  export default css
}
