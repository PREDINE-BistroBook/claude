/* Osteria La Galleria — the menu, transcribed from the paper menu photographed 2026-09-12.
   Prices in euro. Allergen numbers follow EU Regulation 1169/2011 (see ALLERGENS). "v" = marked vegetarian on the
   paper menu. "star" = the paper menu's * (product may be frozen at origin). "perKg" = priced per kilogram.
   "art" = which drawn plate (art.js) stands in until the owner's own photo of that dish is dropped into img/dishes/
   (file named after the dish, see img/dishes/README.md). Keep this file in sync with the kitchen: it is the only place prices live. */

window.ALLERGENS = {
  1:  { it: "Glutine",        en: "Gluten" },
  2:  { it: "Crostacei",      en: "Crustaceans" },
  3:  { it: "Uova",           en: "Eggs" },
  4:  { it: "Pesce",          en: "Fish" },
  5:  { it: "Arachidi",       en: "Peanuts" },
  6:  { it: "Soia",           en: "Soy" },
  7:  { it: "Latte",          en: "Milk" },
  8:  { it: "Frutta a guscio", en: "Tree nuts" },
  9:  { it: "Sedano",         en: "Celery" },
  10: { it: "Senape",         en: "Mustard" },
  11: { it: "Sesamo",         en: "Sesame" },
  12: { it: "Solfiti",        en: "Sulphites" },
  13: { it: "Lupini",         en: "Lupin" },
  14: { it: "Molluschi",      en: "Molluscs" },
};

/* Rooms of the gallery, in visiting order. `wall` is the painted wall colour of that room. */
window.ROOMS = [
  {
    id: "antipasti", numeral: "I", wall: "#1F3A2F", ink: "#F2E8D5",
    title: { it: "Antipasti & Zuppe", en: "Appetizers & Soups" },
    blurb: { it: "Si entra dai salumi e dal pane. Le zuppe sono le tre di Firenze, e basta.",
             en: "You come in through the cured meats and the bread. The soups are Florence's three, and no others." },
    groups: [
      { title: { it: "Antipasti", en: "Appetizers" }, items: [
        { it: "Bruschetta tradizionale al pomodoro fresco", en: "Traditional bruschetta with fresh tomato and basil", dit: "Pomodoro fresco e basilico", art: "bruschetta", price: 8, a: [1], v: true },
        { it: "Crostini toscani", en: "Galleria's canapé specialities", dit: "Le specialità della Galleria", art: "bruschetta", price: 11, a: [1,4,7,9,12] },
        { it: "Soufflè di carciofi e fonduta di pecorino", en: "Artichoke soufflé served with pecorino cream", dit: "Soufflè di carciofi su fonduta di pecorino", art: "cheese", price: 15, a: [1,3,7,12], v: true },
        { it: "Caprese di bufala", en: "Caprese salad with buffalo mozzarella", dit: "Mozzarella di bufala e pomodoro", art: "cheese", price: 15, a: [7], v: true },
        { it: "Prosciutto e melone", en: "Honeydew melon and Italian dry-cured ham", dit: "Prosciutto crudo e melone", art: "tagliere", price: 15, a: [] },
        { it: "Prosciutto e mozzarella di bufala", en: "Italian dry-cured ham and buffalo mozzarella", dit: "Prosciutto crudo e mozzarella di bufala", art: "tagliere", price: 16, a: [7] },
        { it: "Degustazione di pecorino con miele e marmellata", en: "Pecorino platter with honey and caramelised onion chutney", dit: "Pecorini con miele e composta di cipolle caramellate", art: "cheese", price: 19, a: [7,8], v: true },
        { it: "Gran tagliere della Galleria", en: "The house cold-cut platter, for two: Tuscan salami, dry-cured ham, finocchiona, three pecorini of different ages, two canapés with liver pâté, bruschette with tomato and artichokes in oil", dit: "Per due. Salame, prosciutto crudo, finocchiona, tre pecorini di diversa stagionatura, due tartine con patè di fegatini, bruschette con pomodoro e carciofi sott'olio", art: "tagliere", price: 26, a: [1,4,7,9,12], per2: true, feature: true },
        { it: "Carpaccio di bresaola con rucola e grana", en: "Bresaola carpaccio with rocket and grana cheese", dit: "Bresaola, rucola e scaglie di grana", art: "tagliere", price: 18, a: [7] },
      ]},
      { title: { it: "Zuppe", en: "Soups" }, items: [
        { it: "Ribollita", en: "Tuscan bean, vegetable and bread stew", dit: "Fagioli, verdure e pane", art: "soup", price: 12, a: [1,9], v: true },
        { it: "Pappa al pomodoro", en: "Tuscan tomato and bread soup", dit: "Pomodoro e pane", art: "soup", price: 11, a: [1,9], v: true },
        { it: "Minestrone di verdure", en: "Vegetable soup", dit: "Verdure di stagione", art: "soup", price: 12, a: [9], v: true },
      ]},
    ],
  },
  {
    id: "primi", numeral: "II", wall: "#6B3A1B", ink: "#F2E8D5",
    title: { it: "Primi & Pasta fresca", en: "First courses & Fresh pasta" },
    blurb: { it: "Pasta tirata a mano, pomodoro biologico del Mugello.",
             en: "Pasta rolled by hand, organic tomatoes from the Mugello." },
    groups: [
      { items: [
        { it: "Spaghetti al pomodoro", en: "Spaghetti with organic tomato sauce", dit: "Pomodoro bio", art: "pasta", price: 13, a: [1,9,12], v: true },
        { it: "Spaghetti al ragù bolognese", en: "Spaghetti with meat sauce", dit: "Ragù di carne", art: "ragu", price: 14, a: [1,9,12] },
        { it: "Lasagna di carne classica fatta in casa", en: "Classic home-made lasagna", dit: "Fatta in casa", art: "lasagna", price: 13, a: [1,3,7,9,12] },
        { it: "Pici alla carbonara", en: "Fresh pasta with egg, cheese, pork jowl and black pepper", dit: "Uovo, pecorino, guanciale e pepe nero", art: "ragu", price: 16, a: [1,3,7] },
        { it: "Gnocchi alla sorrentina", en: "Handmade gnocchi with organic Mugello tomato and mozzarella", dit: "Gnocchi fatti a mano, pomodoro bio del Mugello e mozzarella", art: "gnocchi", price: 15, a: [1,7,9], v: true },
        { it: "Gnocchetti fatti a mano con crema di gorgonzola e noci", en: "Handmade gnocchi with gorgonzola cream and walnuts", dit: "Crema di gorgonzola e noci", art: "gnocchi-cream", price: 16, a: [1,7,8], v: true },
        { it: "Tagliatelle ai funghi porcini", en: "Fresh tagliatelle with porcini mushroom sauce", dit: "Tagliatelle fresche e porcini", art: "pasta-porcini", price: 18, a: [1,3,12], v: true },
        { it: "Pappardelle al ragù di cinghiale", en: "Fresh pappardelle with wild boar ragù", dit: "Pappardelle fresche e ragù di cinghiale", art: "ragu", price: 16, a: [1,3,12] },
        { it: "Gnocchi al pesto e pomodorini", en: "Gnocchi with pesto and cherry tomatoes", dit: "Pesto e pomodorini", art: "gnocchi", price: 15, a: [1,3,7,8], v: true },
        { it: "Tortelli alla mugellana", en: "Tortelli filled with potato, with bolognese sauce", dit: "Ripieni di patate, con ragù", art: "ravioli", price: 17, a: [1,3,7] },
      ]},
    ],
  },
  {
    id: "tartufo", numeral: "III", wall: "#2A2320", ink: "#F2E8D5",
    title: { it: "Tartufo fresco", en: "Fresh truffle" },
    blurb: { it: "La sala più piccola e la più profumata. Tartufo grattato al tavolo.",
             en: "The smallest room, and the one you smell first. Truffle shaved at the table." },
    groups: [
      { items: [
        { it: "Ravioli ripieni in salsa tartufata", en: "Fresh ravioli with truffle sauce", dit: "Ravioli freschi in salsa al tartufo", art: "ravioli-truffle", price: 17, a: [1,3,7], v: true },
        { it: "Tagliatelle al tartufo fresco", en: "Home-made pasta with fresh truffle", dit: "Pasta fatta in casa e tartufo fresco", art: "pasta-truffle", price: 24, a: [1,3,7], v: true, feature: true },
        { it: "Ravioli al tartufo fresco", en: "Ravioli with fresh truffle", dit: "Ravioli e tartufo fresco", art: "ravioli-truffle", price: 26, a: [1,3,7], v: true },
        { it: "Risotto ai porcini e tartufo", en: "Porcini and fresh truffle risotto", dit: "Porcini e tartufo fresco", art: "risotto", price: 27, a: [7], v: true, star: true },
      ]},
    ],
  },
  {
    id: "secondi", numeral: "IV", wall: "#4A2C22", ink: "#F2E8D5",
    title: { it: "Secondi piatti", en: "Second courses" },
    blurb: { it: "Tre piatti che a Firenze si cucinano da secoli, cotti piano.",
             en: "Three dishes Florence has been cooking for centuries, cooked slowly." },
    groups: [
      { items: [
        { it: "Peposo alla chiantigiana", en: "Beef stew, Chianti style", dit: "Spezzatino al pepe e vino rosso", art: "stew", price: 22, a: [12] },
        { it: "Ossobuco di vitella alla fiorentina", en: "Florentine-style veal marrowbone stew", dit: "Alla fiorentina", art: "stew", price: 24, a: [1,5,8,9,12] },
        { it: "Ossobuco con funghi porcini", en: "Veal marrowbone stew with porcini mushrooms", dit: "Con funghi porcini", art: "stew", price: 28, a: [1,5,8,9,12], star: true },
      ]},
    ],
  },
  {
    id: "pesce", numeral: "V", wall: "#142A44", ink: "#F2E8D5",
    title: { it: "Specialità di pesce", en: "Fish specialities" },
    blurb: { it: "La sala blu. Primi di mare e un'orata con le verdure di stagione.",
             en: "The blue room. Seafood first courses and a sea bream with the season's vegetables." },
    groups: [
      { items: [
        { it: "Risotto ai frutti di mare", en: "Seafood risotto", dit: "Frutti di mare", art: "risotto-sea", price: 16, a: [2,4,7,12,14] },
        { it: "Spaghetti allo scoglio", en: "Seafood spaghetti", dit: "Frutti di mare", art: "seafood", price: 17, a: [2,4,7,12,14] },
        { it: "Spaghetti alle vongole", en: "Spaghetti with clams", dit: "Vongole", art: "seafood", price: 16, a: [1,14] },
        { it: "Linguine all'astice", en: "Linguine with lobster, for two", dit: "Per due persone", art: "lobster", price: 40, a: [1,2,12], per2: true, feature: true },
        { it: "Filetto di orata all'isolana", en: "Fillet of sea bream with seasonal vegetables", dit: "Con verdure stagionali", art: "fish", price: 29, a: [], star: true },
      ]},
    ],
  },
  {
    id: "bistecche", numeral: "VI", wall: "#5A1420", ink: "#F2E8D5",
    title: { it: "Le nostre bistecche & Specialità di carne", en: "Our steaks & Meat specialities" },
    blurb: { it: "Scottona italiana e Chianina IGP, alla griglia. La fiorentina si paga al peso: scegli il tuo taglio qui sotto.",
             en: "Italian scottona and Chianina IGP beef, grilled. The fiorentina is priced by weight: pick your cut below." },
    scale: true,
    groups: [
      { title: { it: "Al peso", en: "By weight" }, items: [
        { it: "Bistecca alla fiorentina", en: "Traditional T-bone steak", dit: "La classica, con l'osso a T", art: "tbone", price: 68, a: [], perKg: true, feature: true },
        { it: "Bistecca nella costola", en: "Ribeye steak, on the bone", dit: "Costata con l'osso", art: "tbone", price: 60, a: [], perKg: true },
      ]},
      { title: { it: "Alla griglia", en: "From the grill" }, items: [
        { it: "Filetto alla griglia", en: "Grilled Chianina IGP beef tenderloin", dit: "Filetto di Chianina IGP", art: "fillet", price: 32, a: [] },
        { it: "Tagliata di manzo con rucola e grana", en: "Thickly-sliced beef with rocket and grana, 300 g", dit: "300 g, rucola e scaglie di grana", art: "tagliata", price: 30, a: [7] },
        { it: "Tagliata di manzo con funghi porcini", en: "Sliced beef with porcini mushrooms", dit: "Con funghi porcini", art: "tagliata", price: 34, a: [] },
        { it: "Costolette d'agnello con patate al forno", en: "Lamb chops with roast potatoes", dit: "Con patate al forno", art: "lamb", price: 28, a: [] },
        { it: "Tagliata di pollo con rucola e grana", en: "Thickly-sliced chicken breast with rocket and grana", dit: "Rucola e scaglie di grana", art: "chicken", price: 24, a: [7] },
        { it: "Bistecca di maiale con patate al forno", en: "Pork steak with roast potatoes, 300 g", dit: "300 g, con patate al forno", art: "chicken", price: 25, a: [] },
      ]},
      { title: { it: "Specialità di carne", en: "Meat specialities" }, items: [
        { it: "Petto di pollo alla parmigiana", en: "Chicken breast cooked in tomato sauce, topped with mozzarella and parmesan", dit: "Mozzarella, parmigiano, pomodoro, origano", art: "chicken-parm", price: 24, a: [1,7,9,12] },
        { it: "Filetto gorgonzola, brandy e noci", en: "Chianina beef tenderloin with gorgonzola, brandy and walnut sauce", dit: "Filetto di Chianina, salsa al gorgonzola, brandy e noci", art: "fillet", price: 35, a: [1,4,7,12], feature: true },
        { it: "Entrecôte al pepe verde", en: "Entrecôte with green pepper sauce", dit: "Salsa al pepe verde", art: "tbone", price: 28, a: [1,4,7,12] },
        { it: "Filetto al tartufo fresco", en: "Tenderloin with fresh truffle", dit: "Filetto e tartufo fresco", art: "fillet", price: 38, a: [] },
      ]},
    ],
  },
  {
    id: "insalate", numeral: "VII", wall: "#33503B", ink: "#F2E8D5",
    title: { it: "Insalatone & Contorni", en: "Big salads & Side dishes" },
    blurb: { it: "Per chi vuole un piatto solo, e per chi vuole qualcosa accanto alla bistecca.",
             en: "For a one-plate lunch, and for whatever you want next to the steak." },
    groups: [
      { title: { it: "Insalatone", en: "Big salads" }, items: [
        { it: "Insalata della casa", en: "Salad, tomatoes, mozzarella, olives, sweetcorn", dit: "Pomodoro, insalata, mozzarella, olive, mais", art: "salad", price: 15, a: [7], v: true },
        { it: "Insalata greca", en: "Tomatoes, salad, cucumber, onion, feta, olives", dit: "Pomodoro, insalata, cetriolo, cipolla, feta, olive", art: "salad", price: 15, a: [7], v: true },
        { it: "Nizzarda", en: "Tuna, onion, olives, salad, mozzarella, eggs, tomatoes", dit: "Tonno, cipolle, olive, insalata, mozzarella, uova, pomodoro", art: "salad", price: 15, a: [3,4,7] },
        { it: "Caesar", en: "Chicken, salad, cucumber, vinaigrette, Parmigiano Reggiano, croutons", dit: "Pollo, insalata, cetriolo, vinaigrette, Parmigiano Reggiano, pan tostato", art: "salad", price: 15, a: [1,3,4,7,12] },
        { it: "Insalata dello chef", en: "Rocket, avocado, fennel, parmesan and cherry tomatoes", dit: "Rucola, avocado, finocchio, parmigiano e pomodorini", art: "salad", price: 18, a: [2], v: true },
        { it: "Insalata Pitti", en: "Avocado, salad, cherry tomatoes, onion and eggs", dit: "Avocado, insalata, pomodorini, cipolla e uova", art: "salad", price: 18, a: [3], v: true },
      ]},
      { title: { it: "Contorni", en: "Side dishes" }, items: [
        { it: "Patate al forno", en: "Roast potatoes", art: "side", price: 8, a: [] },
        { it: "Spinaci", en: "Spinach", art: "side-green", price: 8, a: [], star: true },
        { it: "Fagioli all'olio", en: "Cannellini beans with olive oil, pepper and rosemary", dit: "Cannellini, olio, pepe e rosmarino", art: "beans", price: 8, a: [] },
        { it: "Verdure grigliate", en: "Grilled vegetables", art: "side-green", price: 8, a: [] },
        { it: "Insalata verde", en: "Green salad", art: "side-green", price: 7, a: [] },
      ]},
    ],
  },
  {
    id: "pinsa", numeral: "VIII", wall: "#8A3A22", ink: "#F6EBDA",
    title: { it: "Pinsa", en: "Pinsa" },
    blurb: { it: "Impasto alto e leggero, romano di nascita, fiorentino di condimento.",
             en: "A light, airy base, Roman by birth, Florentine by topping." },
    groups: [
      { items: [
        { it: "Margherita", en: "Tomatoes, mozzarella and basil", dit: "Pomodoro e mozzarella", art: "pinsa", price: 10, a: [1,7], v: true },
        { it: "Napoli", en: "Tomatoes, mozzarella, oregano, capers and anchovies", dit: "Pomodoro, mozzarella, origano, capperi e acciughe", art: "pinsa", price: 14, a: [1,4,7] },
        { it: "Diavola", en: "Tomatoes, mozzarella and spicy salami", dit: "Pomodoro, mozzarella e salame piccante", art: "pinsa", price: 13, a: [1,7] },
        { it: "Prosciutto e funghi", en: "Tomatoes, mozzarella, ham, mushrooms", dit: "Pomodoro, mozzarella, prosciutto cotto, funghi", art: "pinsa", price: 15, a: [1,7] },
        { it: "La Galleria (bianca)", en: "Parma ham, cherry tomatoes, rocket, buffalo mozzarella", dit: "Prosciutto di Parma, pomodorini, rucola, mozzarella di bufala", art: "pinsa-bianca", price: 16, a: [1,7], feature: true },
        { it: "Vegetariana", en: "Tomato, mozzarella, peppers, aubergines, courgettes and olives", dit: "Pomodoro, mozzarella, peperoni, melanzane, zucchine e olive", art: "pinsa", price: 14, a: [1,7], v: true },
        { it: "Pitti", en: "Mortadella, burrata and pistachio", dit: "Mortadella, burrata e pistacchio", art: "pinsa-bianca", price: 15, a: [1,7] },
        { it: "Fiorentina", en: "Tomato, mozzarella, Tuscan salami, baked ham, button mushrooms", dit: "Pomodoro, mozzarella, salame toscano, prosciutto cotto, champignon", art: "pinsa", price: 15, a: [1,7,8] },
      ]},
    ],
  },
  {
    id: "dolci", numeral: "IX", wall: "#4B2540", ink: "#F2E8D5",
    title: { it: "Dolci", en: "Desserts" },
    blurb: { it: "Tutti a nove euro. La torta di mele è la ricetta della nonna, e non si discute.",
             en: "All nine euro. The apple pie is grandmother's recipe, and that is not up for discussion." },
    groups: [
      { items: [
        { it: "Torta di mele, ricetta della nonna", en: "Apple pie", dit: "Ricetta della nonna", art: "cake", price: 9, a: [1,3,7,12], feature: true },
        { it: "Tiramisù", en: "Tiramisù", art: "tiramisu", price: 9, a: [4,3,7] },
        { it: "Torta al cioccolato", en: "Chocolate cake", art: "cake-choc", price: 9, a: [6] },
        { it: "Cheesecake", en: "Cheesecake", art: "cheesecake", price: 9, a: [1,3,7] },
        { it: "Panna cotta", en: "Panna cotta", art: "pannacotta", price: 9, a: [7] },
        { it: "Biscotti di Prato e Vinsanto", en: "Cantuccini biscuits and Vin Santo", dit: "Cantucci da inzuppare nel Vinsanto", art: "biscotti", price: 9, a: [1,3,7,8] },
        { it: "Ananas o frutta fresca", en: "Pineapple or fresh fruit", art: "fruit", price: 9, a: [] },
      ]},
    ],
  },
  {
    id: "cantina", numeral: "X", wall: "#1C1A1A", ink: "#F2E8D5",
    title: { it: "La Cantina", en: "The Cellar" },
    blurb: { it: "Vino al bicchiere, birre toscane degli Artisti della Birra, caffè come si deve.",
             en: "Wine by the glass, Tuscan beers from Artisti della Birra, coffee done properly." },
    compact: true,
    groups: [
      { title: { it: "Vino al bicchiere", en: "Wine by the glass" }, items: [
        { it: "Vino locale", en: "Local wine", art: "wine", price: 7 },
        { it: "Vino Riserva", en: "Riserva wine", art: "wine", price: 9 },
        { it: "Prosecco", en: "Prosecco", art: "wine-sparkling", price: 8 },
        { it: "Rosé", en: "Rosé", art: "wine-rose", price: 9 },
        { it: "Pinot Grigio", en: "Pinot Grigio", art: "wine-white", price: 8 },
        { it: "Chardonnay", en: "Chardonnay", art: "wine-white", price: 8 },
        { it: "Moscato", en: "Moscato", art: "wine-white", price: 8 },
        { it: "Gallo Nero", en: "Chianti Classico Gallo Nero", art: "wine", price: 9 },
        { it: "Vermentino", en: "Vermentino", art: "wine-white", price: 10 },
        { it: "Brunello", en: "Brunello di Montalcino", art: "wine", price: 16 },
        { it: "Bolgheri", en: "Bolgheri", art: "wine", price: 14 },
        { it: "Nobile di Montepulciano", en: "Nobile di Montepulciano", art: "wine", price: 12 },
      ]},
      { title: { it: "Birre", en: "Beer" }, items: [
        { it: "Dante", en: "Strong bitter, 5.1%", dit: "Strong Bitter 5,1% · Artisti della Birra, fatta in Toscana", art: "beer", price: 8.5 },
        { it: "Leonardo", en: "Italian lager, gluten free, 4.9%, 33 cl", dit: "Lager senza glutine 4,9% · 33 cl · Artisti della Birra", art: "beer", price: 8.5 },
        { it: "Amerigo", en: "Strong ale, double malt, 6.2%, 33 cl", dit: "Strong Ale doppio malto 6,2% · 33 cl · Artisti della Birra", art: "beer", price: 8.5 },
        { it: "Galileo", en: "Session IPA, 4.6%, 33 cl", dit: "Session IPA 4,6% · 33 cl · Artisti della Birra", art: "beer", price: 8.5 },
        { it: "Birra analcolica", en: "Non-alcoholic beer, 33 cl", dit: "< 0,5% · 33 cl", art: "beer", price: 7.5 },
        { it: "Birra alla spina, 1 litro", en: "Draft beer premium, 1 litre, 5.1%", dit: "Premium 5,1%", art: "beer", price: 16 },
        { it: "Birra alla spina, 40 cl", en: "Draft beer premium, 40 cl, 5.1%", dit: "Premium 5,1%", art: "beer", price: 8 },
        { it: "Peroni Gran Riserva", en: "Vienna style, 5.2%", dit: "Vienna Style 5,2%", art: "beer", price: 8 },
        { it: "Hefe Weissbier", en: "Weizen, 5.1%, 50 cl", dit: "Weizen 5,1% · 50 cl", art: "beer", price: 8 },
      ]},
      { title: { it: "Aperitivo & liquori", en: "Aperitivo & liqueurs" }, items: [
        { it: "Aperol Spritz", en: "Aperol Spritz", art: "spritz", price: 9 },
        { it: "Amari e liquori nazionali", en: "Italian amari and liqueurs", art: "liqueur", price: 6 },
        { it: "Liquori esteri", en: "Imported spirits", art: "liqueur", price: 8 },
        { it: "Liquori riserva", en: "Reserve spirits", art: "liqueur", price: 15 },
      ]},
      { title: { it: "Caffè & bevande", en: "Coffee & drinks" }, items: [
        { it: "Caffè", en: "Espresso", art: "coffee", price: 3 },
        { it: "Caffè decaffeinato", en: "Decaf espresso", art: "coffee", price: 3.5 },
        { it: "Caffè corretto", en: "Espresso with a shot of liqueur", art: "coffee", price: 5 },
        { it: "Caffè shakerato", en: "Shaken iced espresso", art: "coffee", price: 6 },
        { it: "Americano", en: "Americano", art: "coffee", price: 4 },
        { it: "Cappuccino", en: "Cappuccino", art: "cappuccino", price: 5 },
        { it: "Caffelatte", en: "Caffè latte", art: "cappuccino", price: 5 },
        { it: "Cioccolata calda", en: "Hot chocolate", art: "chocolate", price: 5 },
        { it: "Thè caldo e tisane", en: "Hot tea and infusions", art: "tea", price: 5 },
        { it: "Acqua minerale", en: "Mineral water", art: "water", price: 3 },
        { it: "Bibite", en: "Soft drinks", art: "soda", price: 5.5 },
        { it: "Succo di frutta", en: "Fruit juice", art: "juice", price: 5 },
        { it: "Spremuta", en: "Fresh orange juice", art: "juice", price: 8 },
      ]},
    ],
  },
];

/* Contact details. Empty strings hide the corresponding element on the page — fill in once confirmed by the owner. */
window.SITE = {
  name: "Osteria La Galleria",
  city: "Firenze",
  address: "Piazza de' Pitti, Firenze",   // in front of Palazzo Pitti (Ash, 2026-09-12); street number still to confirm
  phone: "",            // e.g. "+39 055 000 0000"
  whatsapp: "",         // digits only, international format, e.g. "393330000000"
  email: "",
  instagram: "",        // handle without @
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=Osteria+La+Galleria+Piazza+de'+Pitti+Firenze",   // replace with the share link of the real listing
  reviewUrl: "",        // the Google review link behind the QR sticker on the door
  hours: { it: "", en: "" },   // e.g. "Tutti i giorni 11:30 – 23:00"
  happyHour: { drinks: "Spritz · Hugo", price: 7, when: { it: "", en: "" } },
};
