/**
 * Um objeto por CNPJ (verificador de licença, credenciais, sessão Sankhya), criado na primeira
 * chamada daquele cliente e reaproveitado. O gateway é único para todos os clientes, então cada um
 * tem o seu cache. Limite de clientes em memória por instância para não crescer sem fim.
 */
export function porCliente<T>(criar: (cnpj: string) => T, limite = 200): (cnpj: string) => T {
  const mapa = new Map<string, T>();
  return (cnpj) => {
    let v = mapa.get(cnpj);
    if (v === undefined) {
      if (mapa.size >= limite) mapa.delete(mapa.keys().next().value as string);
      v = criar(cnpj);
      mapa.set(cnpj, v);
    }
    return v;
  };
}
