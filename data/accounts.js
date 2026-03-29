const sharedProfile = {
  name: 'gustavo roberto elias',
  email: 'gugusantos22@gmail.com',
  phone: '11981675248',
  documentType: 'cpf',
  documentNumber: '55061412893',
  title: 'Pagamento'
};

const rawAccounts = [
  {
    id: 'op-001',
    login: 'operador01',
    label: 'Operador 01',
    passwordHash:
      'scrypt$5cdef36d08e00183$8773dafbdd03b11bb07ab53ea3dfb10255a270ce78254695343073067282648c721e1cdbb6c8b5808d6054ef8cc5f28ca033dad491308d056c641adf6f7484f1'
  },
  {
    id: 'op-002',
    login: 'operador02',
    label: 'Operador 02',
    passwordHash:
      'scrypt$88969bbab0bdd91d$93c9461f01430d559938dfb7024112e67a79e5a4fa1b60b56e8fbe157a84ccce52c4bdadce337e286b723107abbbca5402023162a322b8780e973ee10a8ce92d'
  },
  {
    id: 'op-003',
    login: 'operador03',
    label: 'Operador 03',
    passwordHash:
      'scrypt$bd483413bdd86614$e6084214ca251d5ec05e851316bd2ff165a4227dbc7db117371b4e9e16bf9fff09cbda4803403eb5a76c46fc770a06e0a79c3685241df02ea27d982f5411203c'
  },
  {
    id: 'op-004',
    login: 'operador04',
    label: 'Operador 04',
    passwordHash:
      'scrypt$12ec3069299113ad$bae07d3a9f640a056ca8410ef82239ce826b64c8a745e630e9eb0ff51fc1ecd430aaacd53f344523435a86e3ff469e27010a87ee1f127a628771afbf813cb531'
  },
  {
    id: 'op-005',
    login: 'operador05',
    label: 'Operador 05',
    passwordHash:
      'scrypt$d936f2b14dd764a2$709e7d9715dfdc5cb9b68c12719a462d57ca0050526796e50734807c787d52ccf0a5ccd20e609f5b90c960ca11b649425d0f81e58582ccb3099cd28e7989d861'
  },
  {
    id: 'op-006',
    login: 'operador06',
    label: 'Operador 06',
    passwordHash:
      'scrypt$a5062af745dbf67f$9815c535e49082419661e2934890f5405236e92afdf76230fcb8ffde36174360b23f588fff10c84426b92a3bec7fe85581e9f2986f352fbca507edd69ee7739e'
  },
  {
    id: 'op-007',
    login: 'operador07',
    label: 'Operador 07',
    passwordHash:
      'scrypt$d25b2c0167a458b7$20f47d155fcfd413c12811b09dee028012627de5ac082df232cccdddbc06ef28ce8598e98cbda587e50560d2e08cc79e7b9c26563f1a489ab7756f66a3381e1a'
  },
  {
    id: 'op-008',
    login: 'operador08',
    label: 'Operador 08',
    passwordHash:
      'scrypt$63872e472904276b$351ec38b59ae914279e9daa2a7042f3dc44dd141e02c8d16b9ab7e51f8c5d78e27f63d06bdf76a94d7707be4038e421f01bb636e043c3b98fe47c79915b24f6e'
  },
  {
    id: 'op-009',
    login: 'operador09',
    label: 'Operador 09',
    passwordHash:
      'scrypt$ff1d48c37eefb8d9$f0dcf7dbd9046adb307f3ae0bf05a880d616acad20e5f37b2d6190ef6d83ae29d7f802217f7af33735fdc9be842e406b184ee2e71b581c702273bc01c918ec5f'
  },
  {
    id: 'op-010',
    login: 'operador10',
    label: 'Operador 10',
    passwordHash:
      'scrypt$b2160c1e3929204e$afc7efd439e409995d7e4514d3f6f2a3916be4dbd49ff7bd14df8580a4651c14ab4711545e21c32643b99832e3c695341a4dcb6d4211a901aee49a51078bb2f4'
  },
  {
    id: 'op-011',
    login: 'operador11',
    label: 'Operador 11',
    passwordHash:
      'scrypt$2372ebf6005ef4e0$f52e42dbbe75f907da07b4189c47e67a4570f9a590413071252ade259f5c825539629590b2ad0f4ff30d8dbb8a2303d3c600b5471039be15b05dcdb7ac4926de'
  },
  {
    id: 'op-012',
    login: 'operador12',
    label: 'Operador 12',
    passwordHash:
      'scrypt$3f2e63f973425b95$5fd38efb09fccace2cdc553434c77629c5d8a3fd625e3f94cbedffc1286ce1a2b3ee185620b51b7d7754a1b598353ecd497f6143b875890e2acfe789c62bbbd8'
  },
  {
    id: 'op-013',
    login: 'operador13',
    label: 'Operador 13',
    passwordHash:
      'scrypt$5ea5a0f7811e3608$9f7d2f70e3208286b9a67697bada62b81b3634c677ea52c87aa4864a3831669fb1c52bed9d86146894b05a31d89a3338cfd3f0941d2c758df14a7117c2a5f5db'
  },
  {
    id: 'op-014',
    login: 'operador14',
    label: 'Operador 14',
    passwordHash:
      'scrypt$5736f15b59d3470e$70c32fdfe488b534b30069571b0165eddeb14077fe571c24c877005f543eaf625c1f80d7c3c668efd8acadc80084debfe9359050d57a6eb8f41d948c93ce1981'
  },
  {
    id: 'op-015',
    login: 'operador15',
    label: 'Operador 15',
    passwordHash:
      'scrypt$4bb26c86cc752263$f4e72d9cf24137a1dda860d702a0217ce320419648a990f404b6ed52fd4e2b5629430e9b7e1db203e1df9ad8e038d216572e2a0fc259301cd8c3aaf286d18b4f'
  },
  {
    id: 'op-016',
    login: 'operador16',
    label: 'Operador 16',
    passwordHash:
      'scrypt$c7c2619fcfdcd51e$7f40e3b038c7613868cbda6d9da590d81aefb6ffb25df055d7086b9bcf7a1a8a7b06dffb6e696a7be3ff797266e30e217ad69797cac434da8df316637c65a0ff'
  },
  {
    id: 'op-017',
    login: 'operador17',
    label: 'Operador 17',
    passwordHash:
      'scrypt$4c8522368662f668$98ff173ccc759b7798258d8e78219894f39489efea35ce3367cb1cfbb25e47c686d85880753076b4904c816e09307742594987d1f9882580c3f054b804e8b205'
  },
  {
    id: 'op-018',
    login: 'operador18',
    label: 'Operador 18',
    passwordHash:
      'scrypt$b071cde851430d6e$b23c73aef3a18a374fd505bae689a2e049da2d62a2e2deacfb7fa6c3ccd6d01726afa3a8f82f5bb61c82714555c5db6e62fa98b1588ad3a4e28569f17253bb02'
  },
  {
    id: 'op-019',
    login: 'operador19',
    label: 'Operador 19',
    passwordHash:
      'scrypt$67b66bbd9ec56920$37fb096ca04925c7308621cf672731a8d202cadc0f13af3d3aa36a2ce7730e8b40978d3ea49bb26c79f3fc3073e65aa053bb985c2206c65bf80b21cec6353c5f'
  },
  {
    id: 'op-020',
    login: 'operador20',
    label: 'Operador 20',
    passwordHash:
      'scrypt$fd5407245229d7a5$8cc2272f5fb6fe749b3d11c9140c688afce61fde3d7f1370724c3afaf8a485bd3a9deda88253965b59ef55606eb98e1d27f23150c7e6b01daeb9a57936b55d5e'
  }
];

export const accounts = rawAccounts.map((account) => ({
  ...account,
  active: true,
  profile: { ...sharedProfile }
}));
