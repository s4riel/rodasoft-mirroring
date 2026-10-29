import { Module } from '@nestjs/common';
import { AdjustmentDocumentsService } from './adjustment-documents.service';
import { EquivalencesController } from './equivalences.controller';
import { EquivalencesService } from './equivalences.service';
import { ProductCommandsService } from './product-commands.service';
import { ProductImportController } from './product-import.controller';
import { ProductImportService } from './product-import.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { StockAdjustmentController } from './stock-adjustment.controller';
import { StockAdjustmentService } from './stock-adjustment.service';
import { StockAdjustmentsController } from './stock-adjustments.controller';
import { StockAdjustmentsService } from './stock-adjustments.service';
import { StockMovementService } from './stock-movement.service';
import { StockQueriesService } from './stock-queries.service';
import { StorageService } from '../../common/storage/storage.service';
import { TransferReceiptsService } from './transfer-receipts.service';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { UploadsController } from './uploads.controller';
import { WarehousesController } from './warehouses.controller';
import { WarehousesService } from './warehouses.service';

@Module({
  controllers: [ProductsController, ProductImportController, EquivalencesController, StockAdjustmentController, StockAdjustmentsController, WarehousesController, TransfersController, UploadsController],
  providers: [
    ProductsService,
    ProductCommandsService,
    ProductImportService,
    EquivalencesService,
    StockQueriesService,
    StockMovementService,
    StockAdjustmentService,
    StockAdjustmentsService,
    WarehousesService,
    TransfersService,
    TransferReceiptsService,
    AdjustmentDocumentsService,
    StorageService,
  ],
})
export class InventoryModule {}
