import "@testing-library/jest-dom/vitest";

// jsdom no implementa scrollIntoView; Radix Select lo llama al montar
// su contenido (al abrir con teclado). Sin este stub, abrir un Select
// en tests rompe con "candidate?.scrollIntoView is not a function".
if (
  typeof Element !== "undefined" &&
  typeof Element.prototype.scrollIntoView !== "function"
) {
  Element.prototype.scrollIntoView = () => {};
}
