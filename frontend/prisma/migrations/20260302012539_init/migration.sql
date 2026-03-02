-- CreateTable
CREATE TABLE "DdmrpProduct" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aduWindowDays" INTEGER,
    "orderCycleDays" INTEGER,
    "greenDays" INTEGER,

    CONSTRAINT "DdmrpProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DdmrpWarehouse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,

    CONSTRAINT "DdmrpWarehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DdmrpSalesDaily" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "qty" INTEGER NOT NULL,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "channel" TEXT NOT NULL DEFAULT 'manual',

    CONSTRAINT "DdmrpSalesDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DdmrpInventorySnapshot" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "allocated" INTEGER NOT NULL DEFAULT 0,
    "onOrder" INTEGER NOT NULL DEFAULT 0,
    "available" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DdmrpInventorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DdmrpSupplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "defaultLeadTimeDays" INTEGER NOT NULL DEFAULT 14,
    "reliabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0,

    CONSTRAINT "DdmrpSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DdmrpProductSupplier" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "leadTimeDays" INTEGER,
    "moq" INTEGER NOT NULL DEFAULT 1,
    "packSize" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DdmrpProductSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DdmrpProfile" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "avgDailyUsage" DOUBLE PRECISION NOT NULL,
    "demandStdDev" DOUBLE PRECISION NOT NULL,
    "leadTimeDays" INTEGER NOT NULL,
    "redBase" DOUBLE PRECISION NOT NULL,
    "redSafety" DOUBLE PRECISION NOT NULL,
    "yellow" DOUBLE PRECISION NOT NULL,
    "green" DOUBLE PRECISION NOT NULL,
    "topOfGreen" DOUBLE PRECISION NOT NULL,
    "netFlowPosition" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "recommendedOrderQty" INTEGER,
    "recommendedOrderDate" DATE,
    "expectedArrivalDate" DATE,
    "riskStockoutDate" DATE,

    CONSTRAINT "DdmrpProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DdmrpSystemConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "aduDefaultWindowDays" INTEGER NOT NULL DEFAULT 28,
    "serviceLevelZ" DOUBLE PRECISION NOT NULL DEFAULT 1.65,
    "orderCycleDays" INTEGER NOT NULL DEFAULT 7,
    "greenDays" INTEGER NOT NULL DEFAULT 7,
    "roundingRule" TEXT NOT NULL DEFAULT 'ceil',

    CONSTRAINT "DdmrpSystemConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DdmrpProduct_sku_key" ON "DdmrpProduct"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "DdmrpSalesDaily_productId_date_channel_key" ON "DdmrpSalesDaily"("productId", "date", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "DdmrpInventorySnapshot_productId_warehouseId_date_key" ON "DdmrpInventorySnapshot"("productId", "warehouseId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DdmrpProductSupplier_productId_supplierId_key" ON "DdmrpProductSupplier"("productId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "DdmrpProfile_productId_warehouseId_asOfDate_key" ON "DdmrpProfile"("productId", "warehouseId", "asOfDate");

-- AddForeignKey
ALTER TABLE "DdmrpSalesDaily" ADD CONSTRAINT "DdmrpSalesDaily_productId_fkey" FOREIGN KEY ("productId") REFERENCES "DdmrpProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DdmrpInventorySnapshot" ADD CONSTRAINT "DdmrpInventorySnapshot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "DdmrpProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DdmrpInventorySnapshot" ADD CONSTRAINT "DdmrpInventorySnapshot_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "DdmrpWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DdmrpProductSupplier" ADD CONSTRAINT "DdmrpProductSupplier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "DdmrpProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DdmrpProductSupplier" ADD CONSTRAINT "DdmrpProductSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "DdmrpSupplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DdmrpProfile" ADD CONSTRAINT "DdmrpProfile_productId_fkey" FOREIGN KEY ("productId") REFERENCES "DdmrpProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DdmrpProfile" ADD CONSTRAINT "DdmrpProfile_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "DdmrpWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
