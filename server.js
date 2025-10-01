import express from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';

const prisma = new PrismaClient();
const app = express();

app.use(express.json());
app.use(cors());

// Cria um novo produto
app.post('/produtoCriar', async (req, res) => {
  const { titulo, preco, descricao, tag, image } = req.body;

  try {
    const produto = await prisma.produto.create({
      data: { titulo, preco, descricao, tag, image },
    });
    // Retorna 201 Created com o novo usuário
    res.status(201).json(produto);
  } catch (error) {
    // Trata erros como email duplicado (UNIQUE constraint)
    res.status(400).json({
      error: 'Não foi possível criar o produto.',
    });
  }
});

// LISTA TODOS OS PRODUTOS
app.get('/listarProdutos', async (req, res) => {
  const produtos = await prisma.produto.findMany();

  res.status(200).json(produtos);
});

app.get('/listarProduto', async (req, res) => {
  const { produtoId } = req.body;

  const produto = await prisma.produto.findUnique({
    where: {
      id: produtoId,
    },
  });

  res.json(produto);
});

// ******************* PRODUTOS COMPRADOS
app.post('/produtoComprado', async (req, res) => {
  const { produto_id, dateBody } = req.body;

  const preco = await prisma.produto.findUnique({
    where: {
      id: produto_id,
    },
    select: {
      preco: true,
    },
  });

  //CADASTRA UM PRODUTO COMO COMPRADO
  const criarProdutoComprado = await prisma.produtoComprado.create({
    data: { date: dateBody, produtoId: produto_id, precoVenda: preco.preco },
  });
  res.status(201).json(criarProdutoComprado);
});

app.get('/listarProdutosComprados', async (req, res) => {
  const produtosComprados = await prisma.produtoComprado.findMany();

  res.status(200).json(produtosComprados);
});

// SOMAR VALOR DOS PRODUTOS VENDIDOS
app.get('/dashboard/metricas', async (req, res) => {
  const totalLeadFicticios = 5000;

  try {
    // A. Busca dos Preços das Vendas (para somar o Faturamento)
    const vendasComPreco = await prisma.produtoComprado.findMany({
      select: {
        produto: {
          select: {
            preco: true,
          },
        },
      },
    });

    //Contagem de Vendas (Total de Transações)
    const totalVendas = await prisma.produtoComprado.count({});

    //Soma dos Preços (Cálculo do Faturamento Total)
    const faturamentoTotal = vendasComPreco.reduce((acc, venda) => {
      return acc + (venda.produto.preco || 0);
    }, 0);

    // Ticket Médio
    const ticketMedio = totalVendas > 0 ? faturamentoTotal / totalVendas : 0;

    // LEAD ficticios
    const totalDeLeads = totalLeadFicticios;
    // Taxa de Conversão
    const taxaDeConversao =
      totalDeLeads > 0 ? (totalVendas / totalDeLeads) * 100 : 0;

    res.json({
      ticketMedio: ticketMedio.toFixed(2),
      faturamentoTotal: faturamentoTotal.toFixed(2),
      totalProdutosVendidos: totalVendas,
      taxaDeConversao: taxaDeConversao.toFixed(2),

      formatados: {
        faturamentoTotal: `R$ ${faturamentoTotal.toFixed(2).replace('.', ',')}`,
        ticketMedio: `R$ ${ticketMedio.toFixed(2).replace('.', ',')}`,
        taxaDeConversao: `${taxaDeConversao.toFixed(2)}%`,
      },
    });
  } catch (error) {
    console.error('Erro ao buscar métricas:', error);
    res
      .status(500)
      .json({ error: 'Erro interno ao consultar o banco de dados.' });
  }
});

// TOP 3 CURSOS POR RECEITA
app.get('/dashboard/cursosPorReceita', async (req, res) => {
  try {
    const topProdutosData = await prisma.produtoComprado.groupBy({
      by: ['produtoId'],
      _sum: {
        precoVenda: true,
      },
      _count: {
        id: true,
      },
      orderBy: {
        _sum: {
          precoVenda: 'desc',
        },
      },
      take: 3, // Limita aos 3 primeiros
    });

    const promisesCursos = topProdutosData.map(async (curso) => {
      const idCurso = curso.produtoId;
      const quantidadeVendida = curso._count.id;
      const receitaTotal = curso._sum.precoVenda || 0;

      const produtoInfo = await prisma.produto.findUnique({
        where: {
          id: idCurso,
        },
        select: {
          titulo: true,
        },
      });

      const receitaFormatada = `R$ ${receitaTotal
        .toFixed(2)
        .replace('.', ',')}`;

      return {
        id: idCurso,
        titulo: produtoInfo ? produtoInfo.titulo : 'Produto Removido',
        quantidade: quantidadeVendida,
        valor: receitaFormatada,
      };
    });

    const cursosFormatados = await Promise.all(promisesCursos);

    res.json(cursosFormatados);
  } catch (error) {
    console.error('Erro ao buscar top cursos por receita:', error);
    res
      .status(500)
      .json({ error: 'Erro interno ao consultar o banco de dados.' });
  }
});

// MÉTRICAS DO GRÁFICO
app.get('/dashboard/graficoLinha', async (req, res) => {
  try {
    const vendas = await prisma.produtoComprado.findMany({
      select: {
        date: true,
        precoVenda: true,
      },
      orderBy: {
        date: 'asc',
      },
    });

    const dadosGrafico = agruparVendasPorMes(vendas);

    res.json(dadosGrafico);
  } catch (error) {
    console.error('Erro ao buscar vendas mensais:', error);
    res
      .status(500)
      .json({ error: 'Erro interno no servidor ao processar vendas.' });
  }
});

// Função auxiliar para formatar o mês (número para nome)
const nomesMeses = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];

/**
 * Agrupa e soma as vendas por mês/ano.
 * @param {Array} vendas - Array de vendas vindo do Prisma (Venda.findMany)
 * @returns {Array} - Array formatado com mes, receita e vendas
 */
function agruparVendasPorMes(vendas) {
  const mapaMensal = {};

  vendas.forEach((venda) => {
    const dataVenda = venda.date;
    const preco = venda.precoVenda || 0;

    const ano = dataVenda.getFullYear();
    const mesIndex = dataVenda.getMonth(); // 0 (Jan) a 11 (Dez)
    const chave = `${ano}-${mesIndex.toString().padStart(2, '0')}`;

    if (!mapaMensal[chave]) {
      mapaMensal[chave] = {
        receita: 0,
        vendas: 0,
        mes: nomesMeses[mesIndex],
      };
    }

    // Acumula a receita e a contagem de vendas
    mapaMensal[chave].receita += preco;
    mapaMensal[chave].vendas += 1;
  });

  // Converte o mapa de volta para um array e ordena cronologicamente
  const resultados = Object.keys(mapaMensal)
    .sort() // Ordena pela chave "Ano-Mês"
    .map((chave) => ({
      mes: mapaMensal[chave].mes,
      receita: parseFloat(mapaMensal[chave].receita.toFixed(2)),
      vendas: mapaMensal[chave].vendas,
    }));

  return resultados;
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
