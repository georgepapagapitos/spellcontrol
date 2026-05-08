# Deck builder attribution

The contents of this directory (`frontend/src/deck-builder/`) are a port of the
deck-generation logic from
[20q2/mtg-commander-deck-generator](https://github.com/20q2/mtg-commander-deck-generator),
licensed under the MIT License.

```
MIT License

Copyright (c) 2026 20q2

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Adaptations

Files under `services/`, `lib/`, and `types/` are largely verbatim ports with
import paths rewritten from `@/` to `@/deck-builder/`. The Zustand store in
`store/` is adapted to coexist with the host app's collection store. UI
components consuming this module live outside this directory in
`frontend/src/components/deck/` and `frontend/src/pages/DeckBuilderPage.tsx`,
written fresh against the host app's CSS-variable theming system.
