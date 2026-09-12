#!/usr/bin/env python3
"""Build public/geo-media/gouda.json from the research results.

Sources: Wikimedia Commons (EXIF GPS), Gouda Tijdmachine / SAMH (georeferenced
historical photos), RCE beeldbank, Flickr, YouTube, real-estate listings, and
Google Street View pano positions gathered with GeoPhotoService.
Headings marked 'guess' or 'estimated' were derived from what is visible in
the picture and the street layout; calibrate them in the app and export.
"""
import json, sys, os

OUT = os.path.join(os.path.dirname(__file__), '../../public/geo-media/gouda.json')
SV_FILE = '/tmp/final_compact.json'

def wm(path, w):
    # path like 'a/a6/Informatiebord_in_Gouda._Majoor_Fransstraat.jpg'; standard widths only
    return f"https://upload.wikimedia.org/wikipedia/commons/thumb/{path}/{w}px-{path.split('/')[-1]}"

items = []
def add(**k):
    items.append(k)

# ---------------- Wikimedia Commons: straatnaamborden (EXIF GPS) ----------------
signs = [
  ('majoor-fransstraat', 'Informatiebord Majoor Fransstraat', 'a/a6/Informatiebord_in_Gouda._Majoor_Fransstraat.jpg', 52.01577238, 4.69861428, 135, 'Majoor Frans van A.L.G. Bosboom-Toussaint'),
  ('roos-van-dekema', 'Informatiebord De roos van Dekemastraat', '0/00/Informatiebord_in_Gouda._De_roos_van_Dekemastraat.jpg', 52.01589453, 4.6983407, 200, 'De roos van Dekema van Jacob van Lennep'),
  ('eline-vere', 'Informatiebord Eline Verestraat', '9/90/Informatiebord_in_Gouda._Eline_Verestraat.jpg', 52.01566849, 4.69893937, 215, 'Eline Vere van Louis Couperus'),
  ('jan-compagnie', 'Informatiebord Jan Compagniestraat', '4/45/Informatiebord_in_Gouda._Jan_Compagniestraat.jpg', 52.01552076, 4.6992386, 215, 'Jan Compagnie van Arthur van Schendel'),
  ('kleine-johannes', 'Informatiebord De kleine Johannesstraat', '7/7d/Informatiebord_in_Gouda._De_kleine_Johannesstraat.jpg', 52.01541195, 4.69952613, 215, 'De kleine Johannes van Frederik van Eeden'),
  ('merijntje-gijzen', 'Informatiebord Merijntje Gijzenstraat', '2/22/Informatiebord_in_Gouda._Merijntje_Gijzenstraat.jpg', 52.01529445, 4.69984563, 215, 'Merijntje Gijzen van A.M. de Jong (110 m, net buiten de cirkel)'),
]
for sid, name, path, lat, lon, hdg, desc in signs:
    add(id=f'commons-bord-{sid}', name=name, kind='photo', lat=lat, lon=lon, headingDeg=hdg, pitchDeg=5, fovDeg=55, rangeM=5, heightM=1.6,
        positionConfidence='exact', headingConfidence='guess',
        thumbnailUrl=wm(path, 960), imageUrl=wm(path, 1280),
        sourceUrl='https://commons.wikimedia.org/wiki/File:' + path.split('/')[-1],
        author='Agaath (Wikimedia Commons)', license='CC BY-SA 4.0', capturedAt='2015-05-24',
        description=f'Straatnaambord met uitleg: {desc}. Cameralocatie uit EXIF; kijkrichting geschat (bord aan de kop van de straat).')

add(id='commons-prinses-gouden-bal', name='De Prinses met de gouden bal (Winterdijk)', kind='photo',
    lat=52.01616944, lon=4.69746667, headingDeg=20, pitchDeg=-5, fovDeg=50, rangeM=8, heightM=1.5,
    positionConfidence='exact', headingConfidence='estimated',
    thumbnailUrl=wm('d/d3/De_Prinses_met_de_gouden_bal_van_C._Heslenfeld.jpg', 960), imageUrl=wm('d/d3/De_Prinses_met_de_gouden_bal_van_C._Heslenfeld.jpg', 1280),
    sourceUrl='https://commons.wikimedia.org/wiki/File:De_Prinses_met_de_gouden_bal_van_C._Heslenfeld.jpg',
    author='Agaath (Wikimedia Commons)', license='CC BY-SA 4.0', capturedAt='2015-10-04',
    description='Kalkstenen sculptuur (1958) van Corinne Franzén-Heslenfeld aan de Winterdijk, met het kantoorgebouw Winterdijk 10 erachter. Het beeld zelf staat volgens OSM op 52.016227, 4.698226.')

add(id='commons-rode-dorp-1-2012', name='Het vernieuwde Rode Dorp, speelplek Parkstraat', kind='photo',
    lat=52.01478, lon=4.69866, headingDeg=30, pitchDeg=0, fovDeg=65, rangeM=20, heightM=1.6,
    positionConfidence='estimated', headingConfidence='estimated',
    thumbnailUrl=wm('9/91/Rode_Dorp1_Gouda.jpg', 960), imageUrl=wm('9/91/Rode_Dorp1_Gouda.jpg', 1280),
    sourceUrl='https://commons.wikimedia.org/wiki/File:Rode_Dorp1_Gouda.jpg',
    author='Gouwenaar (Wikimedia Commons)', license='CC0', capturedAt='2012-11-30',
    description='Speelplek met glijbaan en de nieuwe rode rijwoningen erachter, kort na oplevering. Geen EXIF-GPS; positie afgeleid uit de speelplek in OSM.')
add(id='commons-rode-dorp-2-2012', name='Gedenksteen 100 jaar Mozaïek Wonen', kind='photo',
    lat=52.01490, lon=4.69858, headingDeg=90, pitchDeg=5, fovDeg=40, rangeM=3, heightM=1.5,
    positionConfidence='estimated', headingConfidence='guess',
    thumbnailUrl=wm('c/c0/Rode_Dorp2_Gouda.jpg', 960), imageUrl=wm('c/c0/Rode_Dorp2_Gouda.jpg', 1280),
    sourceUrl='https://commons.wikimedia.org/wiki/File:Rode_Dorp2_Gouda.jpg',
    author='Gouwenaar (Wikimedia Commons)', license='CC0', capturedAt='2012-11-30',
    description='Gevelsteen "1912-2012, 20 maart 2012 start nieuwbouw 67 eengezinswoningen Parkwijk en het Nieuwe Rode Dorp". Welke gevel is niet bekend.')

# ---------------- RCE (via Commons / beeldbank) ----------------
add(id='rce-parkstraat-1994', name='Parkstraat, oude Rode Dorp (RCE 1994)', kind='historical',
    lat=52.01498, lon=4.69876, headingDeg=215, pitchDeg=0, fovDeg=60, rangeM=30, heightM=1.6,
    positionConfidence='estimated', headingConfidence='estimated',
    thumbnailUrl=wm('9/9b/Overzicht_-_Gouda_-_20359085_-_RCE.jpg', 960), imageUrl=wm('9/9b/Overzicht_-_Gouda_-_20359085_-_RCE.jpg', 1280),
    sourceUrl='https://beeldbank.cultureelerfgoed.nl/rce-mediabank/detail/b6b63a33-196c-f074-6c54-0ebee3d7a96e',
    author='Gerard Dukker, Rijksdienst voor het Cultureel Erfgoed', license='CC BY-SA 4.0', capturedAt='1994-12',
    description='Het oude Rode Dorp (1915-16) na de renovatie van 1985: witgepleisterde rijtjes met rode pannen, straat met jonge boom, gesloopt in 2010. Standpunt vermoedelijk noordkop Parkstraat (bij Ferdinand Huyckstraat) kijkend naar het plantsoen, zelfde standpunt als de ansichtkaarten.')
add(id='rce-kanaalstraat-1994', name='Rode Dorp aan de Kanaalstraat vanaf Nieuwe Gouwe O.Z. (RCE 1994)', kind='historical',
    lat=52.01438, lon=4.69690, headingDeg=50, pitchDeg=0, fovDeg=60, rangeM=60, heightM=1.6,
    positionConfidence='estimated', headingConfidence='estimated',
    thumbnailUrl='https://images.memorix.nl/rce/thumb/640x480/36e00587-e33d-22f5-1f8e-4de4cdb028a0.jpg', imageUrl='https://images.memorix.nl/rce/thumb/640x480/36e00587-e33d-22f5-1f8e-4de4cdb028a0.jpg',
    sourceUrl='https://beeldbank.cultureelerfgoed.nl/rce-mediabank/detail/b49a377d-0cce-d305-21f3-71ea53be492f',
    author='Gerard Dukker, Rijksdienst voor het Cultureel Erfgoed', license='CC BY-SA', capturedAt='1994-12',
    description='Overzicht van de Rode-Dorp-rij aan de Kanaalstraat over het water, met het hogere hoekpand links.')
add(id='rce-winterdijk-1999', name='Drielaagse eengezinswoningen Winterdijk (RCE 1999)', kind='historical',
    lat=52.01595, lon=4.69835, headingDeg=210, pitchDeg=0, fovDeg=60, rangeM=30, heightM=1.6,
    positionConfidence='unknown', headingConfidence='guess',
    thumbnailUrl=wm('c/c1/Overzicht_voorgevels_en_rechter_zijgevels_drie_laagse_eengezinswoningen_-_Gouda_-_20358766_-_RCE.jpg', 960), imageUrl=wm('c/c1/Overzicht_voorgevels_en_rechter_zijgevels_drie_laagse_eengezinswoningen_-_Gouda_-_20358766_-_RCE.jpg', 1280),
    sourceUrl='https://beeldbank.cultureelerfgoed.nl/rce-mediabank/detail/93cf0cff-4fea-efb1-2cf6-e210ec2793c8',
    author='Gerard Dukker, Rijksdienst voor het Cultureel Erfgoed', license='CC BY-SA 4.0', capturedAt='1999-09',
    description='Drielaagse bakstenen rijwoningen met plat dak op een hoek, links water met kade. Alleen "Winterdijk, Gouda" als adres; bouwtype past bij de blokwoningen aan de zuidzijde van de Winterdijk, standpunt geschat op de Winterdijk kijkend naar het zuidwesten.')

# ---------------- Gouda Tijdmachine / SAMH ----------------
def gtm(iid, name, uuid, lat, lon, hdg, hconf, date, lic, desc, pos='estimated', rng=40):
    add(id=f'gtm-{iid}', name=name, kind='historical', lat=lat, lon=lon, headingDeg=hdg, pitchDeg=0, fovDeg=60, rangeM=rng, heightM=1.6,
        positionConfidence=pos, headingConfidence=hconf,
        thumbnailUrl=f'https://images.memorix.nl/sahm/iiif/{uuid}/full/960,/0/default.jpg',
        imageUrl=f'https://images.memorix.nl/sahm/iiif/{uuid}/full/1600,/0/default.jpg',
        sourceUrl=f'https://www.goudatijdmachine.nl/omeka/s/data/item/{iid}',
        author='Streekarchief Midden-Holland via Gouda Tijdmachine', license=lic, capturedAt=date, description=desc)
gtm(229438, 'Ansichtkaart Parkstraat zuidwaarts (ca. 1915-1920)', '3b77dabb-4288-20ee-3a54-b07316de30d1', 52.01490, 4.69879, 215, 'estimated', '1915', 'Publiek domein',
    'Kaal plantsoen, kinderen op straat, de eerste Rode-Dorp-woningen (nog in schoon metselwerk). Standpunt noordkop Parkstraat, kijkend naar het park.')
gtm(226352, 'Ansichtkaart De Parkstraat (ca. 1930)', '2a71b829-f108-332f-9f7f-b761d0908e49', 52.01494, 4.69884, 215, 'estimated', '1930', 'Publiek domein',
    'Brede Parkstraat met links de lage arbeiderswoningen, rechts het plantsoen met hek; vrijwel hetzelfde standpunt als de kaart uit ca. 1915.')
gtm(3094107, 'Speeltuin Parkstraat in de sneeuw (1979)', '9cf82e5c-d031-137e-699a-4f39953b49e3', 52.01502, 4.69889, 230, 'estimated', '1979-01-16', 'CC0',
    'Speeltoestellen in het plantsoen; op de achtergrond de lage Rode-Dorp-huizen met pannendaken.', rng=25)
gtm(3027310, 'Omverhalen van een iep in de Parkstraat (1989)', 'be13dc97-4a61-bcd6-930e-6e6981b7005f', 52.01513, 4.69879, 135, 'guess', '1989', 'In copyright (SAMH)',
    'Twee medewerkers van de plantsoenendienst bij een grote iep voor de witgepleisterde Rode-Dorp-woningen.', rng=15)
gtm(2954654, 'Kanaalstraat, Rode Dorp over het water (1999)', '28545e54-8af7-5684-6b52-bba16afe3baa', 52.01451, 4.69726, 45, 'estimated', '1999-03-16', 'In copyright (SAMH)',
    'Rij arbeiderswoningen aan het water, crèmekleurig geïsoleerd (1985), een van de straten van het Rode Dorp. Standpunt westoever Nieuwe Gouwe.', rng=50)
gtm(2955992, 'Zeven blokken woningen Winterdijk in aanbouw (1958)', '85ec6d5b-2f60-bf00-9b0f-a58efebf5b88', 52.01509, 4.70042, 300, 'guess', '1958', 'In copyright (SAMH, niet-commercieel)',
    'Steigers, heistelling en kale bouwstraat: de blokwoningen tussen Winterdijk en Rode Dorp. GTM zet het punt aan de Max Havelaarstraat (ca. 150 m van het middelpunt).', rng=40)
gtm(222535, 'Nieuwe Gouwe oostwaarts ter hoogte van de Kanaalstraat (ca. 1920)', 'be86deec-50b0-752e-6112-e5a952bea4b0', 52.01408, 4.69809, 90, 'estimated', '1920', 'Publiek domein',
    'Het kanaal met links het Van Bergen IJzendoornpark en op de achtergrond de gashouder; net ten zuiden van de cirkel.', rng=80)

# ---------------- Flickr ----------------
def flickr(iid, name, server, secret, lat, lon, hdg, hconf, date, author, desc, pos='estimated', rng=30, kind='photo', owner='windwalkernld'):
    add(id=f'flickr-{iid}', name=name, kind=kind, lat=lat, lon=lon, headingDeg=hdg, pitchDeg=0, fovDeg=60, rangeM=rng, heightM=1.6,
        positionConfidence=pos, headingConfidence=hconf,
        thumbnailUrl=f'https://live.staticflickr.com/{server}/{iid}_{secret}_z.jpg', imageUrl=f'https://live.staticflickr.com/{server}/{iid}_{secret}_b.jpg',
        sourceUrl=f'https://www.flickr.com/photos/{owner}/{iid}/', author=author, license='Alle rechten voorbehouden (Flickr)', capturedAt=date, description=desc)
flickr(4146865421, 'Desolaat: gesloopt Rode Dorp bij zonsondergang (2008)', 2589, 'a4a4d0d936', 52.01470, 4.69760, 110, 'estimated', '2008-10-27', 'WindwalkerNld (Flickr)',
       'Braakliggend terrein na de sloop, met de Bolwerk-torens in aanbouw op de achtergrond. Standpunt Kanaalstraat-zijde.', rng=60)
flickr(7153363711, 'Nieuw Rode Dorp: opgeleverd blok langs de sloot (mei 2012)', 5200, '061df12572', 52.01465, 4.69760, 40, 'estimated', '2012-05-07', 'WindwalkerNld (Flickr)',
       'Net opgeleverd rood blok met pannendak, bouwhekken, sloot op de voorgrond.')
flickr(7007272516, 'Nieuw Rode Dorp in de steigers (mei 2012)', 5234, '504b57a008', 52.01500, 4.69795, 60, 'guess', '2012-05-07', 'WindwalkerNld (Flickr)',
       'Rijwoningen in de steigers langs een bouwweg, modern kantoor op de achtergrond rechts.')
flickr(7007268852, 'Nieuw Rode Dorp: prefab casco\'s en bouwkraan (mei 2012)', 7182, 'bbcf3876f4', 52.01455, 4.69845, 20, 'estimated', '2012-05-07', 'WindwalkerNld (Flickr)',
       'Kalkzandsteen casco\'s met puntgevels, torenkraan, vanaf het bouwhek aan de zuidkant.', rng=50)
flickr(7007267678, 'Nieuw Rode Dorp: kraan tussen twee rijen (mei 2012)', 7188, '3c021b021d', 52.01460, 4.69880, 350, 'estimated', '2012-05-07', 'WindwalkerNld (Flickr)',
       'Bouwkraan tussen twee casco-rijen, bouwhekken en betonelementen.', rng=40)
flickr(6978836993, 'Gouda Kanaalstraat, oude Rode Dorp met sloot (historisch)', 7037, '16f96ca689', 52.01445, 4.69745, 40, 'estimated', None, 'clp59 (Flickr, reproductie)',
       'Zwart-witfoto: rij Rode-Dorp-woningen met dakkapellen, gezin voor de deur, sloot op de voorgrond. Opnamedatum onbekend (vooroorlogs), geüpload 2012.', kind='historical', rng=25, owner='12louise59')
flickr(14296983007, 'Gaaspanelen achterpad nieuw Rode Dorp (2012)', 2940, 'e7b11671e0', 52.01480, 4.69840, 90, 'guess', '2012-07-06', 'Sake Witteveen (Flickr)',
       'Productfoto van hekwerk tussen houten bergingen en de nieuwe rode woningen.', rng=12, owner='22670918@N06')

# ---------------- YouTube ----------------
def yt(vid, name, lat, lon, hdg, hconf, date, author, desc, pos='estimated', pitch=0, rng=25, h=1.6, fov=60):
    add(id=f'yt-{vid}', name=name, kind='video', lat=lat, lon=lon, headingDeg=hdg, pitchDeg=pitch, fovDeg=fov, rangeM=rng, heightM=h,
        positionConfidence=pos, headingConfidence=hconf,
        thumbnailUrl=f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg', imageUrl=f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg',
        sourceUrl=f'https://www.youtube.com/watch?v={vid}', embedUrl=f'https://www.youtube-nocookie.com/embed/{vid}',
        author=author, license='YouTube (standaardlicentie)', capturedAt=date, description=desc)
yt('21O2G_GhpkY', 'Rode Dorp: architectuuranimatie stedenbouwkundig plan (2007)', 52.01476, 4.69857, 0, 'estimated', '2007-08-29', 'marsel verheijde / KENK architecten',
   'Virtuele vlucht over het hof van het nieuwe Rode Dorp (ontwerp 2006, prijsvraag; gebouwd 2012 in aangepaste vorm).', pitch=-45, rng=60, h=40, fov=70)
yt('xB1ihRnINr8', 'RTV Gouwestad: ontruiming buurttuin Kleine Johannesstraat (2021)', 52.01529, 4.69928, 300, 'guess', '2021-10-27', 'RTV Gouwestad',
   'Reportage over de ontruiming van de buurttuin op 19 oktober 2021, met buurtbewoners en groot materieel.')
yt('MnHRUQvHPFg', 'Gaslekkage Noorderstraat/Kanaalstraat (26-11-2012)', 52.01455, 4.69890, 250, 'guess', '2012-11-26', 'Jorg van Krimpen',
   'Interview met de brandweerwoordvoerder; 40 woningen en een kinderdagverblijf ontruimd na een gaslek bij werkzaamheden aan de Kanaalstraat.')
yt('PUd4K4P04h4', 'District8: gaslek Gouda (26-11-2012)', 52.01450, 4.69900, 240, 'guess', '2012-11-27', 'District8',
   'Tweede reportage over hetzelfde gaslek, hoek Noorderstraat/Kanaalstraat.')
yt('w1IL7YtXFLE', 'Makelaarsvideo Kanaalstraat 26 (2025)', 52.0146552, 4.6976196, 340, 'guess', '2025-09-24', 'MakelaarsHome',
   'Woningpresentatie, vooral interieur; jaren-30 woning aan het water.', pos='exact', rng=12)
yt('tG2Z-D0nnMk', 'Makelaarsvideo Kanaalstraat 16 (2020)', 52.014466, 4.6981255, 340, 'guess', '2020-10-13', 'Femme Makelaars',
   'Ruime hoekwoning aan de Kanaalstraat, overwegend interieuropnamen.', pos='exact', rng=12)
yt('FPQHpRbBDCM', 'Makelaarsvideo Noorderstraat 11 (2023)', 52.014435, 4.6991448, 30, 'guess', '2023-09-25', 'De Koning makelaars',
   'Gevel en tuin van een nieuwbouwwoning (Rode Dorp 2012), ca. 115 m van het middelpunt.', pos='exact', rng=12)
yt('h4T3jPYRDWA', 'Harlem Shake, De Goudse Waarden Winterdijk 10 (2013)', 52.0162397, 4.6985904, 180, 'guess', '2013-03-26', 'Bjorn Broer',
   'Binnenopname in een lokaal van de school aan de Winterdijk 10 (gesloten 2016, gesloopt 2025).', pos='estimated', rng=8)
yt('6M26i13QdJw', 'Dans in de gymzaal, Goudse Waarden Winterdijk (2014)', 52.0162397, 4.6985904, 200, 'guess', '2014-04-30', 'Kinnem Atay',
   'Interieur gymzaal van de school aan de Winterdijk 10.', pos='estimated', rng=8)

# ---------------- Makelaarsfoto's en listings ----------------
add(id='blauw-majoor-fransstraat-40', name='Blauw Makelaars: Majoor Fransstraat 40 (30 foto\'s, 2021)', kind='listing',
    lat=52.015779, lon=4.6985886, headingDeg=315, pitchDeg=5, fovDeg=60, rangeM=12, heightM=1.6,
    positionConfidence='exact', headingConfidence='guess',
    thumbnailUrl='https://blauwmakelaars.nl/wp-content/uploads/2021/01/23-6.jpg', imageUrl='https://blauwmakelaars.nl/wp-content/uploads/2021/01/23-6.jpg',
    sourceUrl='https://blauwmakelaars.nl/verkocht-ovb/majoor-fransstraat-40/', author='Blauw Makelaars', license='Makelaarsfoto, rechten bij de makelaar', capturedAt='2021-01',
    description='Hoekwoning split-level (1956), 30 foto\'s: 1-22 interieur, 23-30 voorgevel en tuin. Beeldhost stuurt geen CORS-headers: alleen in het paneel zichtbaar.')
add(id='blauw-noorderstraat-23', name='Blauw Makelaars: Noorderstraat 23 (2020)', kind='listing',
    lat=52.0145823, lon=4.698766, headingDeg=200, pitchDeg=5, fovDeg=60, rangeM=12, heightM=1.6,
    positionConfidence='exact', headingConfidence='guess',
    thumbnailUrl='https://blauwmakelaars.nl/wp-content/uploads/2020/08/01-4.jpg', imageUrl='https://blauwmakelaars.nl/wp-content/uploads/2020/08/01-4.jpg',
    sourceUrl='https://blauwmakelaars.nl/verkocht-ovb/noorderstraat-23/', author='Blauw Makelaars', license='Makelaarsfoto, rechten bij de makelaar', capturedAt='2020-08',
    description='Eengezinswoning nieuw Rode Dorp (2012) met tuin; ca. 30 foto\'s.')
add(id='blauw-kanaalstraat-21', name='Blauw Makelaars: Kanaalstraat 21 (2020)', kind='listing',
    lat=52.0145856, lon=4.6978079, headingDeg=340, pitchDeg=5, fovDeg=60, rangeM=12, heightM=1.6,
    positionConfidence='exact', headingConfidence='guess',
    thumbnailUrl='https://blauwmakelaars.nl/wp-content/uploads/2020/07/01-2.jpg', imageUrl='https://blauwmakelaars.nl/wp-content/uploads/2020/07/01-2.jpg',
    sourceUrl='https://blauwmakelaars.nl/verkocht/kanaalstraat-21/', author='Blauw Makelaars', license='Makelaarsfoto, rechten bij de makelaar', capturedAt='2020-07',
    description='Woning aan de Kanaalstraat, 30 foto\'s.')

funda = [
  ('majoor-fransstraat-30', 'Majoor Fransstraat 30', 52.0155958, 4.6983927, 'https://www.funda.nl/detail/koop/verkocht/gouda/huis-majoor-fransstraat-30/89489201/', 'Verkocht 2025-26; 106 m², 1956, 3 slaapkamers'),
  ('majoor-fransstraat-26', 'Majoor Fransstraat 26', 52.0155254, 4.6983192, 'https://www.funda.nl/detail/koop/verkocht/gouda/huis-majoor-fransstraat-26/43551068/', 'Verkocht ca. 2021-22; split-level hoekwoning'),
  ('roos-van-dekemastraat-6', 'Roos van Dekemastraat 6', 52.0156442, 4.6980112, 'https://www.funda.nl/detail/koop/verkocht/gouda/huis-roos-van-dekemastraat-6/43403870/', 'Verkocht; eengezinswoning met garage, 1957, 99 m²'),
  ('roos-van-dekemastraat-20', 'Roos van Dekemastraat 20', 52.0159017, 4.6982884, 'https://www.funda.nl/detail/koop/verkocht/gouda/huis-roos-van-dekemastraat-20/43642614/', 'Verkocht; hoekwoning met inpandige garage, uitzicht over de Winterdijk'),
  ('roos-van-dekemastraat-25', 'Roos van Dekemastraat 25 (Funda in Business)', 52.0157006, 4.6978364, 'https://www.fundainbusiness.nl/cultureel/verkocht/gouda/object-89341325-roos-van-dekemastraat-25/', 'Maatschappelijk pand 105 m², verkocht 26-01-2026'),
  ('eline-verestraat-1', 'Eline Verestraat 1', 52.0154016, 4.6986177, 'https://www.funda.nl/detail/koop/gouda/huis-eline-verestraat-1/89379877/', 'Te koop (2026); hoekwoning ca. 106 m², balkon zuidoost'),
  ('eline-verestraat-3', 'Eline Verestraat 3', 52.0154768, 4.6986943, 'https://www.funda.nl/detail/koop/gouda/huis-eline-verestraat-3/43074082/', 'Onder bod geweest'),
  ('jan-compagniestraat-6', 'Jan Compagniestraat 6', 52.0152817, 4.6989225, 'https://www.funda.nl/koop/verkocht/gouda/huis-42983111-jan-compagniestraat-6/', 'Verkocht; 1956, 98 m², kelder, 2 balkons'),
  ('merijntje-gijzenstraat-7', 'Merijntje Gijzenstraat 7', 52.0152503, 4.6997452, 'https://www.funda.nl/koop/gouda/huis-42087059-merijntje-gijzenstraat-7/', 'Verkocht o.v.b.; tussenwoning'),
  ('merijntje-gijzenstraat-5', 'Merijntje Gijzenstraat 5', 52.0151773, 4.6996712, 'https://www.funda.nl/koop/verkocht/gouda/huis-40859585-merijntje-gijzenstraat-5/', 'Verkocht ca. 2019-20'),
  ('noorderstraat-29', 'Noorderstraat 29', 52.0146595, 4.6985803, 'https://www.funda.nl/detail/koop/verkocht/gouda/huis-noorderstraat-29/43654760/', 'Verkocht; nieuwbouw 2012, 108 m², label A'),
  ('kanaalstraat-29', 'Kanaalstraat 29', 52.0148792, 4.6968285, 'https://www.funda.nl/detail/koop/verkocht/gouda/huis-kanaalstraat-29/43395861/', 'Verkocht; jaren-30 woning aan het water, 1932, 124 m²'),
  ('kanaalstraat-20', 'Kanaalstraat 20', 52.0145608, 4.6978675, 'https://www.funda.nl/detail/koop/verkocht/gouda/huis-kanaalstraat-20/43769957/', 'Verkocht ca. april 2025'),
  ('kanaalstraat-14', 'Kanaalstraat 14', 52.0143931, 4.6983095, 'https://www.funda.nl/detail/koop/verkocht/gouda/huis-kanaalstraat-14/42189468/', 'Verkocht; hoekwoning label A, zicht op de Gouwe'),
]
for fid, name, lat, lon, url, desc in funda:
    add(id=f'funda-{fid}', name=f'Funda: {name}', kind='listing', lat=lat, lon=lon, headingDeg=0, pitchDeg=0, fovDeg=60, rangeM=8, heightM=1.6,
        positionConfidence='exact', headingConfidence='unknown', sourceUrl=url, author='Funda / makelaar', license='Listingfoto\'s achter bot-verificatie, niet opgehaald',
        capturedAt=None, description=desc + '. Funda blokkeerde het ophalen van de foto\'s; open de bron voor de fotoset.')

# ---------------- Nieuwsfoto's ----------------
add(id='gouda-nl-winterdijk-10-2025', name='Gemeente Gouda: gebouw Winterdijk 10 (2025)', kind='photo',
    lat=52.01605, lon=4.69830, headingDeg=30, pitchDeg=0, fovDeg=60, rangeM=25, heightM=1.6,
    positionConfidence='estimated', headingConfidence='guess',
    thumbnailUrl='https://openpub.gouda.nl/wp-content/uploads/2025/09/Winterdijk-e1756899475925-768x452.png', imageUrl='https://openpub.gouda.nl/wp-content/uploads/2025/09/Winterdijk-e1756899475925-768x452.png',
    sourceUrl='https://www.gouda.nl/actueel/winterdijk-krijgt-flexwoningen-voor-oekrainers-en-goudse-woningzoekenden/', author='Gemeente Gouda', license='Gemeentelijke publicatie', capturedAt='2025-09-03',
    description='Persbericht: Winterdijk 10 wordt gesloopt voor flexwoningen (max. 165 woonplekken, oplevering 2027).')

# ---------------- Google Street View ----------------
sv = [x for x in json.load(open(SV_FILE)) if x.get('type') == 'streetview' and x.get('thumbnail_url') is None and 'pano=' in (x.get('url') or '')]
seen = set()
for x in sv:
    pano = x['url'].split('pano=')[-1]
    if pano in seen: continue
    seen.add(pano)
    add(id=f'sv-{pano}', name=x.get('title') or f'Street View {pano}', kind='streetview', lat=x['lat'], lon=x['lon'],
        headingDeg=x.get('heading_deg') or 0, pitchDeg=0, fovDeg=90, rangeM=8, heightM=2.5,
        positionConfidence='exact', headingConfidence='exact', sourceUrl=x['url'], author='Google Street View', license='Google Maps-voorwaarden',
        capturedAt=x.get('date'), description=(x.get('what_it_shows') or '') + ' Kijkrichting = rijrichting van de camerawagen; oudere opnamen: ' + str(x.get('how_location_was_determined') or ''))

pack = {
  'id': 'gouda-majoor-fransstraat',
  'name': 'Gouda · Majoor Fransstraat 100 m',
  'center': {'lat': 52.015297, 'lon': 4.698233, 'radiusM': 100},
  'groundElevationM': -1.75,
  'notes': 'Samengesteld op 2026-09-12 uit openbare bronnen. Kijkrichtingen met headingConfidence guess/estimated zijn afgeleid uit de beeldinhoud; kalibreer in de app en exporteer.',
  'items': items,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(pack, open(OUT, 'w'), ensure_ascii=False, indent=1)
from collections import Counter
print(len(items), 'items', Counter(i['kind'] for i in items))
