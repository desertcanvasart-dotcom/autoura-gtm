'use client'

import { useEffect } from 'react'

// Makes the iframe document background transparent so the embedding site shows
// through around the panel's rounded corners.
export default function WidgetBodyClass() {
  useEffect(() => {
    document.body.classList.add('widget-embed')
    return () => document.body.classList.remove('widget-embed')
  }, [])
  return null
}
