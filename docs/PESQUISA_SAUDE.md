# HemoSpace — Pesquisa de saúde: o que a literatura sustenta e o que precisa ajustar

> **Aviso:** protótipo educacional de hackathon. Este documento compara as regras do MVP com fontes públicas
> encontradas em 15/11/2026. **Não é validação médica.** Antes de qualquer afirmação clínica na apresentação,
> peça revisão a um profissional de saúde ou mentor com experiência em fisiologia espacial.
> Onde escrevo "não encontrei", significa que a busca não retornou fonte — não que a afirmação seja falsa.

## 1. Resumo: o que está sustentado e o que não está

| Item do MVP | Situação | Ação sugerida |
|---|---|---|
| PAM 70–100 mmHg como faixa normal | Sustentado | Manter. Registrar que <65 é o limiar clínico de hipoperfusão. |
| Deslocamento de fluido para a cabeça em 0g e risco SANS | Sustentado | Manter, com linguagem de "hipótese/associação". |
| LBNP como contramedida | Sustentado como contramedida **em estudo** | Não escrever "trata/reverte SANS". |
| Pressão de pulso: <25 mmHg = vermelho | Parcial | Usar critério proporcional (PP < 25% da sistólica). |
| ITB <0,90 / 0,90–1,30 / >1,30 | Parcial | Ver §2.1: ITB é índice de doença arterial, não de volume. |
| Congestão cefálica = ITB <0,90 + jugular dilatada | Fraco | Basear a zona no ultrassom jugular; ITB só como contexto. |
| Alerta ortostático (Marte/Terra + FC ≥95 + PP <30) | Heurística inventada | Rotular como "alerta de demonstração". |
| "Meta hídrica: 500 mL" | Não confere com a referência encontrada | Trocar por "conforme protocolo da missão" (ou ~15 mL/kg). |
| Volume plasmático −10–15% / "2 litros migram" | Não confirmei | Reescrever como "redução variável" / "parte do fluido migra". |
| Regra visual Lua/Marte | Sem fonte | Manter como recurso visual ilustrativo (hipótese). |

## 2. Detalhe por parâmetro

### 2.1 ITB (índice tornozelo-braquial)
- Referência (AHA 2012; ACC/AHA; AFP 2025): **≤0,90 anormal**, 0,91–0,99 limítrofe, **1,00–1,40 normal**, >1,40 artérias não compressíveis.
  Uma revisão da Cleveland Clinic cita ≥1,30 como não compressível — **as fontes divergem** entre 1,30 e 1,40.
- Regra do MVP: <0,90 azul; 0,90–1,30 verde; >1,30 amarelo. Diferenças: (a) 0,90 exato deveria ser anormal (`<=`);
  (b) limite superior 1,30 vs 1,40; (c) não há faixa limítrofe.
- **Ponto principal:** o ITB é validado para **diagnóstico de doença arterial periférica**. Nas buscas, não encontrei fonte que o use como
  marcador de deslocamento de fluidos ou "déficit de volume distal" em voo. O MVP pode usá-lo como *índice de perfusão distal* (escolha do projeto),
  mas o texto "ITB <0,90 indica risco de desmaio" é mais forte do que o sustentado.
- Sugestão de texto: "ITB ≤0,90 é o limite usado clinicamente para suspeita de doença arterial periférica; aqui é usado como sinal de perfusão distal reduzida (adaptação do projeto)."

### 2.2 PAM (pressão arterial média)
- Fontes: normal em torno de 70–100 mmHg (algumas citam até 110); **<65 mmHg** é o limiar de hipoperfusão em terapia intensiva; 65–69 é faixa limítrofe.
- MVP: azul <70, verde 70–100, amarelo >100. Coerente. A regra "vermelho acima de 100" segue **indefinida** — não inventar; manter amarelo.
- Uma fonte de emergência lembra que PAM normal não garante boa perfusão: interpretar junto com outros sinais (retorno capilar, estado mental).

### 2.3 Pressão de pulso
- Fonte didática: a PP deve ser **pelo menos 25% da sistólica**; abaixo disso é "estreita" e funciona como indicador de baixo volume sistólico (ex.: perda de sangue).
  Persistentemente ≥100 mmHg é preocupante.
- MVP: <25 mmHg absoluto = vermelho; >60 = amarelo. Simplificação aceitável para demo, mas o critério proporcional é o descrito.
- Exemplo: Cenário C, 96/68 → PP 28 mmHg = 29% da sistólica (não é "estreita" pelo critério proporcional). O amarelo do Cenário C vem da heurística ortostática, não da PP.
- O limite >60 amarelo é escolha conservadora do projeto (as fontes tratam valores bem maiores como preocupantes).

### 2.4 Deslocamento cefálico, jugular e SANS
- Em microgravidade há deslocamento de fluido para a cabeça; a **veia jugular interna** fica com maior pressão/área e fluxo alterado. SANS aparece em voos longos (>1 mês)
  e é tratado pela NASA como risco crítico. A pressão intracraniana elevada é uma **hipótese**, ainda não confirmada.
- Medição usada na pesquisa: ultrassom de **volume/área jugular** (e veia porta). LBNP de −25 mmHg por 30 min levou esses valores de volta perto do pré-voo em um estudo;
  em outro, 10–20 min a 25 mmHg **não reverteram** as alterações estruturais do olho. Ou seja: efeito agudo comprovado em medidas venosas/IOP, **sem prova de que previne ou trata SANS**.
- Implicação: a zona "Cabeça e Pescoço" deve depender principalmente do **ultrassom jugular**; ITB é contexto. "Iniciar LBNP 20 min" deve aparecer como contramedida em estudo, com duração "conforme protocolo da missão".
- Braslet (cintas nas coxas): **não encontrei fonte nesta rodada**. Conferir antes de citar. Um estudo em repouso no leito com faixas constritivas manteve o volume plasmático mas não melhorou a tolerância ortostática (contexto diferente do voo).

### 2.5 Intolerância ortostática no retorno à gravidade
- Problema estabelecido pós-voo. Contramedidas usadas: exercício, **carga de fluidos**, vestimentas de compressão, LBNP. Carga hídrica sem a vestimenta não protegeu ~30% dos astronautas do Shuttle.
- Frequência: ~20% após voos de 10–14 dias; uma compilação cita 13 de 65 após voos curtos e 4 de 6 após longos; outra revisão fala em 28–65% conforme duração e teste.
- Mecanismo: queda de volume plasmático + resposta vascular/autonômica; a redução média relatada em homens pré-sincopais foi ~6% (varia muito entre pessoas). Em simulação, a PAM de pré-sincopais pode cair >30 mmHg ao ficar em pé.
- Protocolo descrito em estudo da NASA: carga oral equivalente a salina isotônica **~15 mL/kg em 2 h** (≈1 L para 70 kg). O "500 mL" do blueprint não bate com isso.
- A regra do app (Marte/Terra + FC ≥95 + PP <30) é **heurística do projeto**; a literatura usa teste de ortostase (em pé/inclinação) e compara a queda de PA/FC, não uma regra de repouso.

### 2.6 Lua e Marte
- Não encontrei dados de fluidos corporais em 1/6g e 3/8g nas buscas. A regra visual (seta distal tracejada e mais fraca) vem apenas do raciocínio físico de que há gravidade parcial.
  Apresentar como **ilustração/hipótese**, nunca como medição.

## 3. Mudanças sugeridas no código (por dono do arquivo)

**Dev 2 — `HemodynamicService.java` e o espelho `LocalEngine` em `api.js` (manter os dois iguais):**
1. `classifyABI`: usar `abi <= 0.90` como azul; decidir 1,30 ou 1,40 e registrar em `clinical_rules.json`.
2. `classifyPulsePressure`: acrescentar critério proporcional (`pp / sistólica < 0.25`).
3. `headNeck`: dar peso ao ultrassom jugular; ITB só rebaixa de verde para amarelo, sem exigir os dois para vermelho.
4. Usar o PPG (hoje só validado) ou remover da descrição; usar a panturrilha ou assumir que é só informativa.
5. Rotular o alerta ortostático como heurística no `label`/documentação.

**Dev 4 — `panel.js` (textos):**
1. Substituir "~2 litros migram" e "10–15%" por texto sem número.
2. "Ingerir 500 ml…" → "Carga hídrica conforme protocolo da missão".
3. "LBNP" e "Braslet" como contramedidas **em estudo**.
4. Conferir os 5 perigos da NASA (Human Research Program) nos rótulos "Perigo NASA".

## 4. Linguagem segura para a apresentação
"Protótipo educacional inspirado em pesquisas públicas de fisiologia espacial. Os limiares são simplificações para demonstração e não substituem avaliação médica."

## 5. Fontes consultadas
- AHA — Top things to know: Ankle-Brachial Index — https://professional.heart.org/en/science-news/measurement-and-interpretation-of-the-ankle-brachial-index\top-things-to-know
- AFP 2025, diretrizes ACC/AHA para DAP — https://www.aafp.org/pubs/afp/issues/2025/1100/practice-guidelines-lower-extremity-peripheral-artery.html
- AFP 2012, atualização ACCF/AHA — https://aafp.org/pubs/afp/issues/2012/0515/p1000.html
- Cleveland Clinic J Med, ITB — https://www.ccjm.org/content/73/10_suppl_4/S22.full.pdf
- Fluid Shifts / LBNP e olho (PMC8409923) — https://pmc.ncbi.nlm.nih.gov/articles/PMC8409923
- LBNP, veias jugular/porta/cerebral (PMC8461809) — https://pmc.ncbi.nlm.nih.gov/articles/PMC8461809
- Healio — LBNP agudo não reverteu alterações oculares — https://cm.healio.com/news/ophthalmology/20220708/acute-exposure-to-negative-pressure-did-not-reverse-spaceflightinduced-ocular-changes
- Stern et al. 2023, eixo olho-cérebro e SANS — https://www.nature.com/articles/s41526-023-00300-4.pdf
- NASA HRP, Risk of Orthostatic Intolerance — https://ntrs.nasa.gov/api/citations/20150007319/downloads/20150007319.pdf
- NASA NTRS, pré-síncope pós-voo e carga hídrica — https://ntrs.nasa.gov/api/citations/20100033503/downloads/20100033503.pdf
- Wood et al. 2019, hipotensão ortostática pós-voo — https://www.nature.com/articles/s41526-019-0082-3.pdf
- Heldt & Mark (MIT), simulação de intolerância ortostática — https://lcp-mit-edu.ezproxy.canberra.edu.au/pdf/Heldt05a.pdf
- Hönemann et al. 2024, LBNP/coxas após repouso no leito — https://elib.dlr.de/210353/1/h%C3%B6nemann-et-al-2024-impact-of-daily-lower-body-negative-pressure-or-cycling-followed-by-venous-constrictive-thigh-cuffs.pdf
- MAP/PP: material didático LibreTexts — https://med.libretexts.org/Courses/Chabot_College/BIOS15%3A_Anatomy_and_Physiology_Textbook/19%3A_Optional_Reading/19.08%3A_Mean_Arterial_Pressure_and_Pulse_Pressure
- EMS World, perfusão e PAM — https://www.hmpgloballearningnetwork.com/site/emsworld/feature/understanding-perfusion-mean-arterial-pressure
