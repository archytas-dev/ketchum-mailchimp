// Diff palabra por palabra para el desplegable del Panel PM: que el PM vea que cambio el
// cliente sin tener que leer las dos versiones enteras y compararlas a ojo.
// LCS clasico sobre palabras -- los textos son titulos y copetes (decenas de palabras), asi
// que el O(n*m) no es problema y evita sumar una dependencia.

export type WordDiffPart = { text: string; tipo: "igual" | "quitado" | "agregado" };

function tokenize(s: string): string[] {
  return s.split(/(\s+)/).filter((t) => t.length > 0);
}

export function wordDiff(antes: string, despues: string): { izq: WordDiffPart[]; der: WordDiffPart[] } {
  const a = tokenize(antes);
  const b = tokenize(despues);

  // lcs[i][j] = longitud de la subsecuencia comun mas larga entre a[i..] y b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const izq: WordDiffPart[] = [];
  const der: WordDiffPart[] = [];
  const push = (arr: WordDiffPart[], text: string, tipo: WordDiffPart["tipo"]) => {
    const last = arr[arr.length - 1];
    if (last && last.tipo === tipo) last.text += text;
    else arr.push({ text, tipo });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(izq, a[i], "igual");
      push(der, b[j], "igual");
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push(izq, a[i], "quitado");
      i++;
    } else {
      push(der, b[j], "agregado");
      j++;
    }
  }
  while (i < a.length) push(izq, a[i++], "quitado");
  while (j < b.length) push(der, b[j++], "agregado");

  return { izq: unirPorEspacios(izq), der: unirPorEspacios(der) };
}

// El espacio entre dos palabras cambiadas matchea como "igual" (es el mismo caracter en las
// dos versiones), asi que "fin de semana" saldria resaltado como "fin" + espacio sin resaltar
// + "de semana". Se absorben esos espacios al bloque para que el resaltado sea uno solo.
function unirPorEspacios(partes: WordDiffPart[]): WordDiffPart[] {
  const out: WordDiffPart[] = [];
  for (let k = 0; k < partes.length; k++) {
    const p = partes[k];
    const anterior = out[out.length - 1];
    const siguiente = partes[k + 1];
    const esEspacioEntreCambios =
      p.tipo === "igual" &&
      p.text.trim() === "" &&
      anterior?.tipo !== "igual" &&
      siguiente?.tipo === anterior?.tipo;
    if (esEspacioEntreCambios && anterior) {
      anterior.text += p.text;
    } else if (anterior && anterior.tipo === p.tipo) {
      anterior.text += p.text;
    } else {
      out.push({ ...p });
    }
  }
  return out;
}
